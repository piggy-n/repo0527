import type { SceneBudget, SceneBudgetSource, Unsubscribe } from '@mx/map-core';
import { WorkerHost } from '@mx/utils';
import { type InjectionKey, type Ref, shallowRef } from 'vue';
import { fetchSceneTierSetting } from '../../config/scene-tier-file';
import {
  SCENE_TIER_BUDGETS,
  SCENE_TIERS,
  type SceneTier,
  type SceneTierSetting
} from '../../config/scene-tier-options';
import { type DeviceStore, deviceStore } from '../../storage/device-store';
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
import { autoTier } from './renderer-class';
import { PING_CHANNEL, type ScenePingProtocol } from './scene-tier-ping-protocol';

// 三维的设备档位（ADR 0155，docs/config/scene-tier.md）：配置的档位或 auto，再按崩溃记下的上限、这次会话丢上下文的次数往下降。
// 渲染器只按这里给的预算做（ADR 0155 第 6 节）

const ANSWER_TIMEOUT_MS = 2000;

const rank = (tier: SceneTier): number => SCENE_TIERS.indexOf(tier);
const lower = (tier: SceneTier, steps: number): SceneTier => SCENE_TIERS[Math.max(0, rank(tier) - steps)] ?? 'low';
const lowest = (tiers: readonly SceneTier[]): SceneTier =>
  tiers.reduce((low, tier) => (rank(tier) < rank(low) ? tier : low), 'high');

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
  /** 读部署的档位，不抛错 */
  readonly loadSetting: () => Promise<SceneTierSetting>;
  /** 这个页面的 id：每次打开、刷新都新生成 */
  readonly pageId: string;
  /** 等别的页面回答多久，默认 2 秒 */
  readonly answerTimeoutMs?: number;
}

/** 一个页面一个：所有三维渲染器共用，崩溃标记按页面记 */
export class SceneTierSource implements SceneBudgetSource, SceneTierNoticeSource, Disposable {
  readonly #options: SceneTierOptions;
  readonly #notice = shallowRef<SceneTierNotice | null>(null);
  readonly #listeners = new Set<(budget: SceneBudget) => void>();
  readonly #stack = new DisposableStack();
  #setting: Promise<SceneTierSetting> | undefined;
  #prepared: Promise<void> | undefined;
  #configured: SceneTierSetting = 'auto';
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

  /** 读部署的档位：预加载三维模块时就读，只读一次 */
  loadSetting(): Promise<SceneTierSetting> {
    this.#setting ??= this.#options.loadSetting();
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
    this.#base ??= this.#configured === 'auto' ? autoTier(renderer) : this.#configured;
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
    if (this.#notice.value?.restorable !== true) {
      return;
    }
    this.#record = { configured: this.#configured, cap: null, restorable: true, restoredBefore: true };
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

  async #prepare(): Promise<void> {
    const { store, channel, pageId, answerTimeoutMs = ANSWER_TIMEOUT_MS } = this.#options;
    this.#configured = await this.loadSetting();
    this.#record = readRecord(store, this.#configured);
    void this.#startPing(pageId);
    const crashed = await findCrashed(store, channel, pageId, this.#configured, answerTimeoutMs);
    if (crashed.length > 0) {
      this.#crashed(crashed);
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
  #crashed(markers: readonly CrashMarker[]): void {
    const record = readRecord(this.#options.store, this.#configured);
    const below = lower(lowest(markers.map(marker => marker.tier)), 1);
    const cap = lowest([below, record?.cap ?? 'high']);
    // 恢复过的页面又崩：恢复了马上又崩，不再给恢复；以后的页面再崩照样给
    const restorable = !markers.some(marker => marker.restored);
    const restoredBefore = !restorable || record?.restoredBefore === true;
    this.#record = { configured: this.#configured, cap, restorable, restoredBefore };
    writeRecord(this.#options.store, this.#record);
    this.#notice.value = { restorable, restoredBefore };
  }

  #tier(base: SceneTier): SceneTier {
    const capped = lowest([base, this.#record?.cap ?? 'high']);
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

/** 浏览器里的：一个页面只建一个（app 在第一个地图页建） */
export function createSceneTierSource(): SceneTierSource {
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
    pageId: newPageId()
  });
}
