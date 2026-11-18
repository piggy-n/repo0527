import type { SceneBudget, SceneBudgetSource, Unsubscribe } from '@mx/map-core';
import { WorkerHost } from '@mx/utils';
import { type InjectionKey, type Ref, shallowRef } from 'vue';
import { fetchSceneTierSetting } from '../../config/scene-tier-file';
import {
  SCENE_TIER_BUDGETS,
  SCENE_TIER_NAMES,
  SCENE_TIERS,
  type SceneTier,
  type SceneTierSetting
} from '../../config/scene-tier-options';
import { type DeviceStore, deviceStore } from '../../storage/device-store';
import { type AutoTier, autoTier } from './auto-tier';
import {
  type CrashMarker,
  findCrashed,
  onMarkerRemoved,
  type PingChannel,
  readRecord,
  type TierRecord,
  writeMarker,
  writeRecord
} from './crash-markers';
import { PING_CHANNEL, type ScenePingProtocol } from './scene-tier-ping-protocol';

// 三维的设备档位（ADR 0155、0166，docs/config/scene-tier.md）：本浏览器的设定或部署文件里的档位、auto，
// 再按崩溃记下的上限、这次会话丢上下文的次数往下降。渲染器只按这里给的预算做（ADR 0155 第 6 节）

const ANSWER_TIMEOUT_MS = 2000;

const rank = (tier: SceneTier): number => SCENE_TIERS.indexOf(tier);
const lower = (tier: SceneTier, steps: number): SceneTier => SCENE_TIERS[Math.max(0, rank(tier) - steps)] ?? 'low';
// 没记上限时的上限：最高的一档，不写某一档的名字（写成 high 时工作站档会被压到高档）
const HIGHEST: SceneTier = SCENE_TIERS.at(-1) ?? 'low';
const lowest = (tiers: readonly SceneTier[]): SceneTier =>
  tiers.reduce((low, tier) => (rank(tier) < rank(low) ? tier : low), HIGHEST);

/** 用的档位从哪来：部署文件、本浏览器的设定，或者读不到部署文件（按 auto） */
type SettingOrigin = 'file' | 'browser' | 'missing';

const ORIGIN_NAMES: Readonly<Record<SettingOrigin, string>> = {
  file: '部署文件',
  browser: '本浏览器设定',
  missing: '读不到部署文件'
};

// 按 auto 定的写在依据前面；部署文件写的 auto 不另写来源
const AUTO_PREFIXES: Readonly<Record<SettingOrigin, string>> = {
  file: '',
  browser: '本浏览器设定 ',
  missing: '读不到部署文件，按 '
};

// 没按显存定档的原因
const UNSIZED_REASONS: Readonly<Record<Exclude<AutoTier['basis'], 'listed'>, string>> = {
  unlisted: '显存表里没有',
  hidden: '浏览器不给显卡型号',
  integrated: '集显',
  software: '软件渲染'
};

// auto 的依据：查到显存的写型号和显存（内存压低了时写上内存），别的写原因和显卡的名字
function describeAuto(auto: AutoTier): string {
  if (auto.basis !== 'listed') {
    return `${UNSIZED_REASONS[auto.basis]}「${auto.device}」`;
  }
  const memory = auto.memoryCap === null ? '' : `；内存 ${auto.memoryCap} GB，最多${SCENE_TIER_NAMES[auto.tier]}`;
  return `${auto.device}，${auto.vram} GB${memory}`;
}

/** 控制台里定档的那一行（现场核对用，docs/deployment.md"三维的设备档位"） */
function tierLine(tier: SceneTier, base: SceneTier, origin: SettingOrigin, auto: AutoTier | null): string {
  const from = auto === null ? ORIGIN_NAMES[origin] : `${AUTO_PREFIXES[origin]}auto：${describeAuto(auto)}`;
  const capped = tier === base ? '' : `；这台设备崩溃后降过档，原来是${SCENE_TIER_NAMES[base]}`;
  return `[scene-tier] 三维档位：${SCENE_TIER_NAMES[tier]}（${from}${capped}）`;
}

/** 崩溃降档的提示：能不能恢复、这台设备恢复过以后又崩溃过没有 */
export interface SceneTierNotice {
  readonly restorable: boolean;
  readonly restoredBefore: boolean;
}

/** 地图上的降档提示要的：提示的状态、恢复原来的画质、关掉 */
export interface SceneTierNoticeSource {
  readonly notice: Readonly<Ref<SceneTierNotice | null>>;
  restore(): void;
  dismissNotice(): void;
}

/** app 提供；没有时（测试、开发页）不提示 */
export const SCENE_TIER_NOTICE: InjectionKey<SceneTierNoticeSource> = Symbol('scene-tier-notice');

/** 页面在不在前台：可见、没冻结、没离开（pagehide） */
export interface PageLifecycle {
  active(): boolean;
  subscribe(listener: () => void): Unsubscribe;
}

export interface SceneTierOptions {
  readonly store: DeviceStore;
  readonly channel: PingChannel;
  readonly lifecycle: PageLifecycle;
  /** 开替页面回答"还在"的 Worker，开始听广播后结束 */
  readonly startPing: (id: string) => Promise<void>;
  /** 读部署的档位，不抛错；读不到时是 null */
  readonly loadSetting: () => Promise<SceneTierSetting | null>;
  /** 本浏览器的设定：这个页面启动时读到的（现状底图的地址显示的也是它）；没有时读部署文件 */
  readonly browserSetting?: SceneTierSetting;
  /** 这个页面的 id：每次打开、刷新都新生成 */
  readonly pageId: string;
  /** 等别的页面回答多久，默认 2 秒 */
  readonly answerTimeoutMs?: number;
  /** navigator.deviceMemory（GB）：auto 按它压低档位，没有时不压 */
  readonly deviceMemory?: number;
}

/** 一个页面一个：所有三维渲染器共用，崩溃标记按页面记 */
export class SceneTierSource implements SceneBudgetSource, SceneTierNoticeSource, Disposable {
  readonly #options: SceneTierOptions;
  readonly #notice = shallowRef<SceneTierNotice | null>(null);
  readonly #listeners = new Set<(budget: SceneBudget) => void>();
  readonly #stack = new DisposableStack();
  #setting: Promise<SceneTierSetting | null> | undefined;
  #prepared: Promise<void> | undefined;
  // 配置的档位：本浏览器的设定，没有时是部署文件里的；null 是都没有（读不到部署文件）：按 auto 定档，但不当成配置变了。
  // 降档记录、崩溃标记按它记，所以改了本浏览器的设定和改部署文件一样，这台设备记的降档清掉
  #configured: SceneTierSetting | null = null;
  #origin: SettingOrigin = 'missing';
  #record: TierRecord | undefined;
  // 配置或 auto 定下的档位：第一个渲染器挂上时按显卡的名字定
  #base: SceneTier | undefined;
  #drops = 0;
  #shown = 0;
  #pingReady = false;
  #restored = false;
  #current: SceneTier | undefined;

  constructor(options: SceneTierOptions) {
    this.#options = options;
    this.#stack.defer(options.lifecycle.subscribe(() => this.#syncMarker()));
    this.#stack.defer(onMarkerRemoved(options.channel, options.pageId, () => this.#syncMarker()));
    this.#stack.defer(() => writeMarker(options.store, options.pageId, null));
  }

  get notice(): Readonly<Ref<SceneTierNotice | null>> {
    return this.#notice;
  }

  /** 读配置的档位：预加载三维模块时就读，只读一次；本浏览器有设定时按它、不读部署文件，部署文件读不到时是 null */
  loadSetting(): Promise<SceneTierSetting | null> {
    this.#setting ??= this.#loadSetting();
    return this.#setting;
  }

  /** 第一次打开三维、创建渲染器之前：读配置，开回答的 Worker，问留下标记的页面还在不在。只做一次，不抛错 */
  prepare(): Promise<void> {
    // 出错时按已经读到的配置和记的降档：不能让三维因为检查失败打不开，重试也不会再查
    this.#prepared ??= this.#prepare().catch((error: unknown) => {
      console.warn('[scene-tier] 检查崩溃标记出错，按配置的档位', error);
    });
    return this.#prepared;
  }

  resolve(renderer: string): SceneBudget {
    if (this.#base === undefined) {
      const setting = this.#configured ?? 'auto';
      let auto: AutoTier | null = null;
      if (setting === 'auto') {
        auto = autoTier(renderer, this.#options.deviceMemory);
        this.#base = auto.tier;
      } else {
        this.#base = setting;
      }
      // oxlint-disable-next-line no-console -- 定下的档位和依据留在控制台，现场按这一行核对（ADR 0166）
      console.info(tierLine(this.#tier(this.#base), this.#base, this.#origin, auto));
    }
    const tier = this.#tier(this.#base);
    this.#current = tier;
    this.#syncMarker();
    return SCENE_TIER_BUDGETS[tier];
  }

  subscribe(listener: (budget: SceneBudget) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 丢了上下文：这次会话降一档，连续丢就一直降到低档 */
  contextLost(): void {
    if (this.#current !== undefined && this.#current !== 'low') {
      this.#drops++;
      this.#changed();
    }
  }

  /** 三维挂上、撤下（切回二维、离开地图页、释放）：标记跟着记、删 */
  shown(shown: boolean): void {
    this.#shown = Math.max(0, this.#shown + (shown ? 1 : -1));
    this.#syncMarker();
  }

  /** 提示里的"恢复原来的画质"：立即生效，清掉上限，记上这个页面恢复过 */
  restore(): void {
    const configured = this.#configured;
    // 有提示就读到了配置：没读到时不检查崩溃
    if (this.#notice.value?.restorable !== true || configured === null) {
      return;
    }
    this.#record = { configured, cap: null, restorable: true, restoredBefore: true };
    writeRecord(this.#options.store, this.#record);
    this.#restored = true;
    this.#notice.value = null;
    this.#changed();
  }

  dismissNotice(): void {
    this.#notice.value = null;
  }

  [Symbol.dispose](): void {
    this.#stack.dispose();
  }

  async #loadSetting(): Promise<SceneTierSetting | null> {
    const browser = this.#options.browserSetting;
    if (browser !== undefined) {
      this.#origin = 'browser';
      return browser;
    }
    const file = await this.#options.loadSetting();
    this.#origin = file === null ? 'missing' : 'file';
    return file;
  }

  async #prepare(): Promise<void> {
    const { store, channel, pageId, answerTimeoutMs = ANSWER_TIMEOUT_MS } = this.#options;
    const configured = await this.loadSetting();
    this.#configured = configured;
    this.#record = readRecord(store, configured);
    void this.#startPing(pageId);
    // 没读到配置：分不出别的页面的标记是不是改配置以前的，不问、不删，留给下一个读到配置的页面
    if (configured === null) {
      return;
    }
    const crashed = await findCrashed(store, channel, pageId, configured, answerTimeoutMs);
    if (crashed.length > 0) {
      this.#crashed(crashed, configured);
    } else {
      // 同时检查的页面可能先认定了同一次崩溃、删了键，降档记在它刚写的记录里
      this.#record = readRecord(store, configured);
    }
  }

  // Worker 回报就绪以后才写标记，不然刚写上就被问到会答不上；开不了时这个页面不留标记
  async #startPing(id: string): Promise<void> {
    try {
      await this.#options.startPing(id);
    } catch (error) {
      console.warn('[scene-tier] 开不了回答"还在"的 Worker，这个页面不留崩溃标记', error);
      return;
    }
    this.#pingReady = true;
    this.#syncMarker();
  }

  // 降到崩溃页面当时的档位的下一档和已经记的上限里更低的那个：两个页面同时发现同一次崩溃，结果一样
  // 记的降档重新读：同时发现这次崩溃的页面可能刚写过
  #crashed(markers: readonly CrashMarker[], configured: SceneTierSetting): void {
    const record = readRecord(this.#options.store, configured);
    const below = lower(lowest(markers.map(marker => marker.tier)), 1);
    const cap = lowest([below, record?.cap ?? HIGHEST]);
    // 恢复过的页面又崩：恢复了马上又崩，不再给恢复；以后的页面再崩照样给
    const restorable = !markers.some(marker => marker.restored);
    const restoredBefore = !restorable || record?.restoredBefore === true;
    this.#record = { configured, cap, restorable, restoredBefore };
    writeRecord(this.#options.store, this.#record);
    this.#notice.value = { restorable, restoredBefore };
  }

  #tier(base: SceneTier): SceneTier {
    const capped = lowest([base, this.#record?.cap ?? HIGHEST]);
    return lower(capped, this.#drops);
  }

  #changed(): void {
    if (this.#base !== undefined) {
      const tier = this.#tier(this.#base);
      if (tier !== this.#current) {
        this.#current = tier;
        for (const listener of this.#listeners) {
          listener(SCENE_TIER_BUDGETS[tier]);
        }
      }
    }
    this.#syncMarker();
  }

  // 低档以外、三维开着、页面在前台、Worker 能替它回答时才有标记；档位变了就改写
  #syncMarker(): void {
    const tier = this.#current;
    const marked =
      tier !== undefined &&
      tier !== 'low' &&
      this.#shown > 0 &&
      this.#pingReady &&
      this.#options.lifecycle.active();
    writeMarker(
      this.#options.store,
      this.#options.pageId,
      marked ? { tier, configured: this.#configured, restored: this.#restored } : null
    );
  }
}

// 内网走 HTTP，不是安全上下文，没有 crypto.randomUUID
function newPageId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
}

// 隐藏、冻结、离开（pagehide）的页面不留标记：后台被节流、冻结、丢弃的标签页不算崩溃
function browserLifecycle(): PageLifecycle {
  const listeners = new Set<() => void>();
  let frozen = false;
  let left = false;
  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const on = (target: EventTarget, type: string, change: () => void) => {
    target.addEventListener(type, () => {
      change();
      emit();
    });
  };
  document.addEventListener('visibilitychange', emit);
  on(document, 'freeze', () => {
    frozen = true;
  });
  on(document, 'resume', () => {
    frozen = false;
  });
  on(window, 'pagehide', () => {
    left = true;
  });
  on(window, 'pageshow', () => {
    left = false;
  });
  return {
    active: () => document.visibilityState === 'visible' && !frozen && !left,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

// navigator.deviceMemory 只有 Chromium 内核在安全上下文里有，DOM 的类型里也没有；没有时 auto 不按内存压档位
function browserDeviceMemory(): number | undefined {
  const { deviceMemory } = navigator as Navigator & { deviceMemory?: unknown };
  return typeof deviceMemory === 'number' ? deviceMemory : undefined;
}

/** 浏览器里的：一个页面只建一个（app 在第一个地图页建）；browserSetting 是这个页面启动时读到的本浏览器的设定 */
export function createSceneTierSource(browserSetting: SceneTierSetting | undefined): SceneTierSource {
  const host = new WorkerHost<ScenePingProtocol>({
    createWorker: () =>
      new Worker(new URL('./scene-tier-ping.worker.ts', import.meta.url), { type: 'module', name: 'scene-tier-ping' })
  });
  return new SceneTierSource({
    store: deviceStore,
    channel: new BroadcastChannel(PING_CHANNEL),
    lifecycle: browserLifecycle(),
    startPing: id => host.request('listen', { channel: PING_CHANNEL, id }),
    loadSetting: () => fetchSceneTierSetting(),
    pageId: newPageId(),
    deviceMemory: browserDeviceMemory(),
    browserSetting
  });
}
