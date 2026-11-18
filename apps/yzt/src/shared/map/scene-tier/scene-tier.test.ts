// @vitest-environment node
import type { SceneBudget } from '@mx/map-core';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { z } from 'zod';
import { SCENE_TIER_BUDGETS, type SceneTier, type SceneTierSetting } from '../../config/scene-tier-options';
import { createDeviceStore, type DeviceStore } from '../../storage/device-store';
import { MemoryStorage } from '../../storage/testing';
import { applySceneTierQuery } from './browser-setting';
import type { PingChannel } from './crash-markers';
import { SceneTierSource } from './scene-tier';
import type { PingMessage } from './scene-tier-ping-protocol';

const DGPU = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const IGPU = 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)';
// 现场的工作站（ADR 0166）：按 ANGLE 的格式写的，没在现场的浏览器里读过
const RTX4090 = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const QUADRO = 'ANGLE (NVIDIA, NVIDIA Quadro RTX 5000 Direct3D11 vs_5_0 ps_5_0, D3D11)';

// 内存里的 BroadcastChannel：发给同一个频道的其他端，异步送达，不送给自己
function createHub() {
  const endpoints = new Set<FakeChannel>();
  const sent: PingMessage[] = [];

  class FakeChannel implements PingChannel {
    readonly #listeners = new Set<(event: MessageEvent) => void>();

    constructor() {
      endpoints.add(this);
    }

    postMessage(message: PingMessage): void {
      sent.push(message);
      for (const endpoint of endpoints) {
        if (endpoint !== this) {
          queueMicrotask(() => endpoint.deliver(message));
        }
      }
    }

    addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
      this.#listeners.add(listener);
    }

    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
      this.#listeners.delete(listener);
    }

    deliver(data: unknown): void {
      for (const listener of this.#listeners) {
        listener(new MessageEvent('message', { data }));
      }
    }

    close(): void {
      endpoints.delete(this);
    }
  }

  return {
    sent,
    channel: () => new FakeChannel(),
    // 替页面回答"还在"的 Worker：和真的一样，只回答 ping
    answerFor(id: string) {
      const worker = new FakeChannel();
      worker.addEventListener('message', event => {
        if ((event.data as PingMessage).kind === 'ping') {
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- 假的 BroadcastChannel，没有 targetOrigin
          worker.postMessage({ kind: 'alive', id });
        }
      });
      return () => worker.close();
    }
  };
}

function fakeLifecycle() {
  const listeners = new Set<() => void>();
  let active = true;
  return {
    active: () => active,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: boolean) {
      active = next;
      for (const listener of listeners) {
        listener();
      }
    }
  };
}

const MARKER = (id: string) => `scene-tier:page:${id}`;
const RECORD = 'scene-tier:record';

// 只经过微任务的等待：结束了的一定结束了
const settled = (promise: Promise<unknown>) =>
  Promise.race([promise.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 0))]);

const disposables: Disposable[] = [];
// 定档时控制台的一行：不打印，用例按它断言
let info: MockInstance<typeof console.info>;

beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const disposable of disposables.splice(0)) {
    disposable[Symbol.dispose]();
  }
  info.mockRestore();
});

interface PageOptions {
  readonly storage: Storage;
  readonly hub: ReturnType<typeof createHub>;
  readonly id: string;
  /** 部署文件里的档位；null 是没读到 scene-tier.json */
  readonly setting?: SceneTierSetting | null;
  /** 本浏览器的设定：这个页面启动时读到的 */
  readonly browser?: SceneTierSetting;
  readonly answerTimeoutMs?: number;
  readonly deviceMemory?: number;
}

// 一个页面：自己的档位来源，Worker 就绪后替它回答；loads 记下读部署文件的次数
function openPage({ storage, hub, id, setting = 'auto', browser, answerTimeoutMs = 20, deviceMemory }: PageOptions) {
  const store: DeviceStore = createDeviceStore(storage);
  const lifecycle = fakeLifecycle();
  let stopAnswering: (() => void) | undefined;
  const channel = hub.channel();
  const loads = { count: 0 };
  const source = new SceneTierSource({
    store,
    channel,
    lifecycle,
    startPing: async pageId => {
      stopAnswering = hub.answerFor(pageId);
    },
    loadSetting: async () => {
      loads.count++;
      return setting;
    },
    pageId: id,
    answerTimeoutMs,
    deviceMemory,
    browserSetting: browser
  });
  disposables.push(source);
  return {
    source,
    lifecycle,
    loads,
    // 崩溃：页面和 Worker 都没了，标记留下
    crash() {
      stopAnswering?.();
      channel.close();
    }
  };
}

function setup() {
  const storage = new MemoryStorage();
  const hub = createHub();
  const store = createDeviceStore(storage);
  // 读标记只为断言，不按格式校验
  const marker = (id: string) => store.get(MARKER(id), z.unknown());
  const leaveMarker = (id: string, tier: SceneTier, restored = false, configured: SceneTierSetting = 'auto') =>
    storage.setItem(`yzt.device.${MARKER(id)}`, JSON.stringify({ tier, configured, restored }));
  const record = () => {
    const raw = storage.getItem(`yzt.device.${RECORD}`);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  };
  return { storage, hub, marker, leaveMarker, record };
}

// 打开三维：准备好、渲染器挂上
async function open3d(source: SceneTierSource, renderer = DGPU): Promise<SceneBudget> {
  await source.prepare();
  const budget = source.resolve(renderer);
  source.shown(true);
  await Promise.resolve();
  return budget;
}

// 别的页面以配置的档位（默认高档）崩溃过，这个页面打开三维发现了
async function crashedOnce(restored = false, tier: SceneTier = 'high') {
  const context = setup();
  context.leaveMarker('b', tier, restored, tier);
  const page = openPage({ storage: context.storage, hub: context.hub, id: 'a', setting: tier });
  await open3d(page.source);
  return { ...context, ...page };
}

describe('SceneTierSource 的档位', () => {
  it.each([
    ['auto、6 GB 显存的独显（用户测试的 RTX 3060 Laptop）', 'auto', DGPU, 'standard'],
    ['auto、集显', 'auto', IGPU, 'low'],
    ['auto、读不到型号', 'auto', '', 'standard'],
    ['auto、现场的 RTX 4090（24 GB）', 'auto', RTX4090, 'workstation'],
    ['auto、现场的 Quadro RTX 5000（16 GB）', 'auto', QUADRO, 'workstation'],
    ['配置写了高档', 'high', IGPU, 'high'],
    ['配置写了工作站档：没记上限时不压到高档', 'workstation', IGPU, 'workstation'],
    ['配置写了低档', 'low', DGPU, 'low']
  ] as const)('%s → %s 档', async (_, setting, renderer, tier) => {
    const { storage, hub } = setup();
    const { source } = openPage({ storage, hub, id: 'a', setting });
    await expect(open3d(source, renderer)).resolves.toStrictEqual(SCENE_TIER_BUDGETS[tier]);
  });

  it('检查出错时不抛给三维：按读到的配置照常创建渲染器', async () => {
    const { storage } = setup();
    using warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const source = new SceneTierSource({
      store: createDeviceStore(storage),
      channel: {
        postMessage: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      },
      lifecycle: fakeLifecycle(),
      startPing: async () => undefined,
      loadSetting: () => Promise.reject(new Error('读不到')),
      pageId: 'a'
    });
    disposables.push(source);

    await expect(source.prepare()).resolves.toBeUndefined();
    expect(source.resolve(DGPU)).toStrictEqual(SCENE_TIER_BUDGETS.standard);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('丢上下文：这次会话降一档，连续丢降到低档为止；订阅的渲染器收到新的预算', async () => {
    const { storage, hub } = setup();
    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await open3d(source);
    const budgets: SceneBudget[] = [];
    source.subscribe(budget => budgets.push(budget));

    source.contextLost();
    source.contextLost();
    source.contextLost();

    expect(budgets).toStrictEqual([SCENE_TIER_BUDGETS.standard, SCENE_TIER_BUDGETS.low]);
  });

  it('工作站档丢上下文：一次降一档，先到高档，不跳过', async () => {
    const { storage, hub } = setup();
    const { source } = openPage({ storage, hub, id: 'a', setting: 'workstation' });
    await open3d(source);
    const budgets: SceneBudget[] = [];
    source.subscribe(budget => budgets.push(budget));

    source.contextLost();
    source.contextLost();
    source.contextLost();
    source.contextLost();

    expect(budgets).toStrictEqual([SCENE_TIER_BUDGETS.high, SCENE_TIER_BUDGETS.standard, SCENE_TIER_BUDGETS.low]);
  });
});

describe('SceneTierSource 的崩溃标记', () => {
  it('三维开着、页面在前台、Worker 就绪时有标记；切回二维、隐藏时删掉，回来再写', async () => {
    const { storage, hub, marker } = setup();
    const { source, lifecycle } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await open3d(source);
    expect(marker('a')).toStrictEqual({ tier: 'high', configured: 'high', restored: false });

    source.shown(false);
    expect(marker('a')).toBeUndefined();
    source.shown(true);
    expect(marker('a')).toBeDefined();

    lifecycle.set(false);
    expect(marker('a')).toBeUndefined();
    lifecycle.set(true);
    expect(marker('a')).toBeDefined();
  });

  it('档位变了就改写，降到低档时删掉', async () => {
    const { storage, hub, marker } = setup();
    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await open3d(source);

    source.contextLost();
    expect(marker('a')).toMatchObject({ tier: 'standard' });
    source.contextLost();
    expect(marker('a')).toBeUndefined();
  });

  it('Worker 就绪之前不写标记：刚写上就被问到会答不上', async () => {
    const { storage, hub, marker } = setup();
    const store = createDeviceStore(storage);
    let ready: (() => void) | undefined;
    const source = new SceneTierSource({
      store,
      channel: hub.channel(),
      lifecycle: fakeLifecycle(),
      startPing: () =>
        new Promise<void>(resolve => {
          ready = resolve;
        }),
      loadSetting: async () => 'high',
      pageId: 'a'
    });
    disposables.push(source);
    await open3d(source);
    expect(marker('a')).toBeUndefined();

    ready?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(marker('a')).toBeDefined();
  });

  it('低档不留标记', async () => {
    const { storage, hub, marker } = setup();
    const { source } = openPage({ storage, hub, id: 'a' });
    await open3d(source, IGPU);
    expect(marker('a')).toBeUndefined();
  });

  it('没有别的页面的键时不问、不等', async () => {
    const { storage, hub } = setup();
    const { source } = openPage({ storage, hub, id: 'a', answerTimeoutMs: 60_000 });
    expect(await settled(source.prepare())).toBe(true);
    expect(hub.sent).toStrictEqual([]);
  });

  it('别的页面还开着：它的 Worker 回答了就不等，不降档、不提示，它的键留着', async () => {
    const { storage, hub, marker } = setup();
    const other = openPage({ storage, hub, id: 'b', setting: 'high' });
    await open3d(other.source);
    const { source } = openPage({ storage, hub, id: 'a', setting: 'high', answerTimeoutMs: 60_000 });

    const prepared = source.prepare();
    const timeout = new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 200));
    await expect(Promise.race([prepared.then(() => 'answered'), timeout])).resolves.toBe('answered');
    expect(source.resolve(DGPU)).toStrictEqual(SCENE_TIER_BUDGETS.high);
    expect(source.notice.value).toBeNull();
    expect(marker('b')).toBeDefined();
  });

  it('留下标记的页面不在了：降到它的档位的下一档，删掉它的键并广播，提示里能恢复', async () => {
    const { storage, hub, marker, record } = setup();
    const crashed = openPage({ storage, hub, id: 'b', setting: 'high' });
    await open3d(crashed.source);
    crashed.crash();

    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.standard);
    expect(source.notice.value).toStrictEqual({ restorable: true, restoredBefore: false });
    expect(marker('b')).toBeUndefined();
    expect(hub.sent).toContainEqual({ kind: 'removed', id: 'b' });
    expect(record()).toStrictEqual({ configured: 'high', cap: 'standard', restorable: true, restoredBefore: false });
  });

  it('工作站档的页面崩了：标记、降档记录里的工作站档读得回来，降一档到高档，不跳到标准档', async () => {
    const { storage, hub, marker, record } = setup();
    const crashed = openPage({ storage, hub, id: 'b', setting: 'workstation' });
    await open3d(crashed.source);
    expect(marker('b')).toStrictEqual({ tier: 'workstation', configured: 'workstation', restored: false });
    crashed.crash();

    const { source } = openPage({ storage, hub, id: 'a', setting: 'workstation' });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.high);
    expect(source.notice.value).toStrictEqual({ restorable: true, restoredBefore: false });
    expect(marker('b')).toBeUndefined();
    expect(marker('a')).toStrictEqual({ tier: 'high', configured: 'workstation', restored: false });
    expect(record()).toStrictEqual({ configured: 'workstation', cap: 'high', restorable: true, restoredBefore: false });
    // 记的降档读得回来：以后的页面照样按高档，不再提示
    const later = openPage({ storage, hub, id: 'c', setting: 'workstation' });
    await expect(open3d(later.source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.high);
    expect(later.source.notice.value).toBeNull();
  });

  it('部署从高档改成工作站档：高档时记的降档和标记都不算，按工作站档重新开始', async () => {
    const { storage, hub, leaveMarker, marker, record } = setup();
    leaveMarker('b', 'standard', false, 'high');
    storage.setItem(
      `yzt.device.${RECORD}`,
      JSON.stringify({ configured: 'high', cap: 'standard', restorable: false, restoredBefore: true })
    );
    const { source } = openPage({ storage, hub, id: 'a', setting: 'workstation' });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.workstation);
    expect(source.notice.value).toBeNull();
    expect(marker('b')).toBeUndefined();
    expect(record()).toBeNull();
  });

  it('留下标记的页面在等回答时正常离开（删了键、Worker 没答上）：不算崩溃，不降档、不提示', async () => {
    const { storage, hub, leaveMarker, record } = setup();
    // 恢复过画质的页面：误判成崩溃时还会取消恢复入口
    leaveMarker('b', 'high', true, 'high');
    // 页面 b 收到问话时正在关闭：pagehide 删掉自己的键，Worker 随页面一起没了，不回答
    const leaving = hub.channel();
    leaving.addEventListener('message', event => {
      if ((event.data as PingMessage).kind === 'ping') {
        storage.removeItem(`yzt.device.${MARKER('b')}`);
      }
    });

    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.high);
    expect(source.notice.value).toBeNull();
    expect(record()).toBeNull();
    expect(hub.sent).not.toContainEqual({ kind: 'removed', id: 'b' });
  });

  it('按崩溃页面的档位降，不在现在的基础上再降：两个页面同时发现同一次崩溃，不会从高直接降到低', async () => {
    const { storage, hub, leaveMarker } = setup();
    leaveMarker('b', 'high', false, 'high');
    const first = openPage({ storage, hub, id: 'a', setting: 'high' });
    const second = openPage({ storage, hub, id: 'c', setting: 'high' });

    await Promise.all([first.source.prepare(), second.source.prepare()]);
    expect(first.source.resolve(DGPU)).toStrictEqual(SCENE_TIER_BUDGETS.standard);
    expect(second.source.resolve(DGPU)).toStrictEqual(SCENE_TIER_BUDGETS.standard);
  });

  it('另一个页面刚为同一次崩溃记了降档：照样按崩溃页面的档位算，不再降一档', async () => {
    const { storage, hub, leaveMarker, record } = setup();
    leaveMarker('b', 'high', false, 'high');
    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    const prepared = source.prepare();
    storage.setItem(
      `yzt.device.${RECORD}`,
      JSON.stringify({ configured: 'high', cap: 'standard', restorable: true, restoredBefore: false })
    );
    await prepared;
    expect(source.resolve(DGPU)).toStrictEqual(SCENE_TIER_BUDGETS.standard);
    expect(record()).toMatchObject({ cap: 'standard' });
  });

  it('几个页面一起留下标记（关机、断电）：按最低的那个降一档，算一次', async () => {
    const { storage, hub, leaveMarker } = setup();
    leaveMarker('b', 'high', false, 'high');
    leaveMarker('c', 'standard', false, 'high');
    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.low);
  });

  it('配置里的档位不同的旧标记直接删掉，不算崩溃；记的降档也清掉', async () => {
    const { storage, hub, leaveMarker, marker, record } = setup();
    leaveMarker('b', 'high', false, 'high');
    storage.setItem(
      `yzt.device.${RECORD}`,
      JSON.stringify({ configured: 'high', cap: 'low', restorable: true, restoredBefore: false })
    );
    const { source } = openPage({ storage, hub, id: 'a', setting: 'auto' });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.standard);
    expect(source.notice.value).toBeNull();
    expect(marker('b')).toBeUndefined();
    expect(record()).toBeNull();
    expect(hub.sent.some(message => message.kind === 'ping')).toBe(false);
  });

  it('被检查的页面误删了键（没答上）：收到广播后补写', async () => {
    const { storage, hub, marker } = setup();
    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await open3d(source);
    storage.removeItem(`yzt.device.${MARKER('a')}`);

    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- 假的 BroadcastChannel，没有 targetOrigin
    hub.channel().postMessage({ kind: 'removed', id: 'a' });
    await Promise.resolve();
    expect(marker('a')).toStrictEqual({ tier: 'high', configured: 'high', restored: false });
  });

  it('释放时删掉自己的标记', async () => {
    const { storage, hub, marker } = setup();
    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await open3d(source);
    source[Symbol.dispose]();
    expect(marker('a')).toBeUndefined();
  });
});

describe('SceneTierSource 的恢复', () => {
  it('恢复原来的画质：立即生效，清掉上限，按升上去的档位改写标记并记上恢复过', async () => {
    const { source, marker, record } = await crashedOnce();
    const budgets: SceneBudget[] = [];
    source.subscribe(budget => budgets.push(budget));

    source.restore();

    expect(budgets).toStrictEqual([SCENE_TIER_BUDGETS.high]);
    expect(source.notice.value).toBeNull();
    expect(marker('a')).toStrictEqual({ tier: 'high', configured: 'high', restored: true });
    expect(record()).toStrictEqual({ configured: 'high', cap: null, restorable: true, restoredBefore: true });
  });

  it('工作站档崩溃后恢复：回到工作站档，记录读得回来，下一个页面也按工作站档', async () => {
    const { storage, hub, source, marker, record } = await crashedOnce(false, 'workstation');
    const budgets: SceneBudget[] = [];
    source.subscribe(budget => budgets.push(budget));

    source.restore();

    expect(budgets).toStrictEqual([SCENE_TIER_BUDGETS.workstation]);
    expect(marker('a')).toStrictEqual({ tier: 'workstation', configured: 'workstation', restored: true });
    expect(record()).toStrictEqual({ configured: 'workstation', cap: null, restorable: true, restoredBefore: true });
    const next = openPage({ storage, hub, id: 'c', setting: 'workstation' });
    await expect(open3d(next.source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.workstation);
  });

  it('恢复过的页面又崩：不再给恢复', async () => {
    const { source, record } = await crashedOnce(true);
    expect(source.notice.value).toStrictEqual({ restorable: false, restoredBefore: true });
    expect(record()).toMatchObject({ cap: 'standard', restorable: false });

    const budgets: SceneBudget[] = [];
    source.subscribe(budget => budgets.push(budget));
    source.restore();
    expect(budgets).toStrictEqual([]);
  });

  it('恢复以后，以后的页面再崩照样给恢复，提示里注明恢复后又崩溃过', async () => {
    const { storage, hub, source } = await crashedOnce();
    source.restore();
    source.shown(false);

    const reopened = openPage({ storage, hub, id: 'c', setting: 'high' });
    await open3d(reopened.source);
    reopened.crash();
    const later = openPage({ storage, hub, id: 'd', setting: 'high' });
    await expect(open3d(later.source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.standard);
    expect(later.source.notice.value).toStrictEqual({ restorable: true, restoredBefore: true });
  });

  it('关掉提示以后不再出，降下来的档位留着', async () => {
    const { source, record } = await crashedOnce();
    source.dismissNotice();
    expect(source.notice.value).toBeNull();
    expect(record()).toMatchObject({ cap: 'standard' });
  });
});

describe('SceneTierSource 读不到配置时（null）', () => {
  it('按 auto 定档，但不当成改了配置：降档记录（包括不能恢复的）照用，不问、不删别的页面的标记', async () => {
    const { storage, hub, leaveMarker, marker, record } = setup();
    leaveMarker('b', 'high', false, 'high');
    const kept = { configured: 'high', cap: 'low', restorable: false, restoredBefore: true };
    storage.setItem(`yzt.device.${RECORD}`, JSON.stringify(kept));
    const { source } = openPage({ storage, hub, id: 'a', setting: null });

    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.low);
    expect(source.notice.value).toBeNull();
    expect(record()).toStrictEqual(kept);
    expect(marker('b')).toBeDefined();
    expect(hub.sent).toStrictEqual([]);
  });

  it('没有记的降档时按显卡定：集显低档、独显标准档', async () => {
    const { storage, hub } = setup();
    const igpu = openPage({ storage, hub, id: 'a', setting: null });
    await expect(open3d(igpu.source, IGPU)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.low);
    const dgpu = openPage({ storage, hub, id: 'b', setting: null });
    await expect(open3d(dgpu.source, DGPU)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.standard);
  });

  it('这个页面的标记记成没读到配置，读到配置的页面照样认：它崩了算崩溃', async () => {
    const { storage, hub, marker } = setup();
    const blind = openPage({ storage, hub, id: 'b', setting: null });
    await open3d(blind.source);
    expect(marker('b')).toStrictEqual({ tier: 'standard', configured: null, restored: false });
    blind.crash();

    const { source } = openPage({ storage, hub, id: 'a', setting: 'high' });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.low);
    expect(source.notice.value).toStrictEqual({ restorable: true, restoredBefore: false });
    expect(marker('b')).toBeUndefined();
  });
});

describe('SceneTierSource 的 auto 和内存', () => {
  it.each([
    ['不给内存（Firefox、Safari、http 下）：不压', undefined, 'workstation'],
    ['32 GB：不压', 32, 'workstation'],
    ['8 GB：分不出是不是旧版 Chrome 的封顶，不压', 8, 'workstation'],
    ['16 GB（Chrome 147 起才报）：最多高档', 16, 'high'],
    ['4 GB：最多标准档', 4, 'standard']
  ] as const)('RTX 4090，%s', async (_, deviceMemory, tier) => {
    const { storage, hub } = setup();
    const { source } = openPage({ storage, hub, id: 'a', deviceMemory });
    await expect(open3d(source, RTX4090)).resolves.toStrictEqual(SCENE_TIER_BUDGETS[tier]);
  });

  it('配置写了档位时不按内存压：内存只用在 auto', async () => {
    const { storage, hub } = setup();
    const { source } = openPage({ storage, hub, id: 'a', setting: 'workstation', deviceMemory: 4 });
    await expect(open3d(source, RTX4090)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.workstation);
  });
});

describe('SceneTierSource 定档时控制台里的一行', () => {
  it.each([
    ['部署文件写 auto：型号和查到的显存', 'auto', QUADRO, '工作站档（auto：NVIDIA Quadro RTX 5000，16 GB）'],
    ['部署文件写 auto：用户测试的笔记本', 'auto', DGPU, '标准档（auto：NVIDIA GeForce RTX 3060 Laptop GPU，6 GB）'],
    ['部署文件写了档位', 'workstation', DGPU, '工作站档（部署文件）'],
    ['读不到部署文件', null, RTX4090, '工作站档（读不到部署文件，按 auto：NVIDIA GeForce RTX 4090，24 GB）'],
    ['集显', 'auto', IGPU, '低档（auto：集显「Intel(R) UHD Graphics 620」）'],
    [
      '显存表里没有',
      'auto',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      '标准档（auto：显存表里没有「NVIDIA GeForce GTX 980」）'
    ],
    [
      'Firefox 换成了代表型号',
      'auto',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar',
      '标准档（auto：浏览器不给显卡型号「ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar」）'
    ],
    ['拿不到调试扩展', 'auto', 'WebKit WebGL', '标准档（auto：浏览器不给显卡型号「WebKit WebGL」）']
  ] as const)('%s；定下以后再挂渲染器不再写', async (_, setting, renderer, line) => {
    const { storage, hub } = setup();
    const { source } = openPage({ storage, hub, id: 'a', setting });
    await open3d(source, renderer);
    source.resolve(renderer);

    expect(info.mock.calls).toStrictEqual([[`[scene-tier] 三维档位：${line}`]]);
  });

  it('按内存压低了：写上内存', async () => {
    const { storage, hub } = setup();
    const { source } = openPage({ storage, hub, id: 'a', deviceMemory: 16 });
    await open3d(source, RTX4090);
    expect(info).toHaveBeenCalledWith(
      '[scene-tier] 三维档位：高档（auto：NVIDIA GeForce RTX 4090，24 GB；内存 16 GB，最多高档）'
    );
  });

  it('这台设备崩溃后降过档：写降下来的档位和原来的', async () => {
    await crashedOnce(false, 'workstation');
    expect(info).toHaveBeenCalledWith('[scene-tier] 三维档位：高档（部署文件；这台设备崩溃后降过档，原来是工作站档）');
  });

  it('本浏览器的设定：写来源，auto 也写', async () => {
    const { storage, hub } = setup();
    const store = createDeviceStore(storage);
    const low = applySceneTierQuery('?scene-tier=low', store);
    await open3d(openPage({ storage, hub, id: 'a', setting: 'workstation', browser: low }).source);
    const auto = applySceneTierQuery('?scene-tier=auto', store);
    await open3d(openPage({ storage, hub, id: 'b', setting: 'workstation', browser: auto }).source, QUADRO);

    expect(info.mock.calls).toStrictEqual([
      ['[scene-tier] 三维档位：低档（本浏览器设定）'],
      ['[scene-tier] 三维档位：工作站档（本浏览器设定 auto：NVIDIA Quadro RTX 5000，16 GB）']
    ]);
  });
});

describe('SceneTierSource 和本浏览器的设定（地址栏的 scene-tier）', () => {
  it.each([
    ['auto', 'workstation'],
    ['low', 'low'],
    ['standard', 'standard'],
    ['high', 'high'],
    ['workstation', 'workstation']
  ] as const)('设定 %s：代替部署文件（低档），不读部署文件 → %s', async (value, tier) => {
    const { storage, hub } = setup();
    const browser = applySceneTierQuery(`?scene-tier=${value}`, createDeviceStore(storage));
    const { source, loads } = openPage({ storage, hub, id: 'a', setting: 'low', browser });
    await expect(open3d(source, QUADRO)).resolves.toStrictEqual(SCENE_TIER_BUDGETS[tier]);
    expect(loads.count).toBe(0);
  });

  it('只按这个页面启动时读到的设定：别的标签页后来记下的不用（地址栏显示的就是实际用的）', async () => {
    const { storage, hub } = setup();
    const browser = applySceneTierQuery('', createDeviceStore(storage));
    applySceneTierQuery('?scene-tier=workstation', createDeviceStore(storage));
    const { source, loads } = openPage({ storage, hub, id: 'a', setting: 'low', browser });
    await expect(open3d(source, QUADRO)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.low);
    expect(loads.count).toBe(1);
  });

  it('设定可以比部署文件低：部署文件写工作站档，这个浏览器设成低档', async () => {
    const { storage, hub } = setup();
    const browser = applySceneTierQuery('?scene-tier=low', createDeviceStore(storage));
    const { source } = openPage({ storage, hub, id: 'a', setting: 'workstation', browser });
    await expect(open3d(source, RTX4090)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.low);
  });

  it('default 清掉设定，回到部署文件', async () => {
    const { storage, hub } = setup();
    const store = createDeviceStore(storage);
    applySceneTierQuery('?scene-tier=low', store);
    const browser = applySceneTierQuery('?scene-tier=default', store);
    const { source, loads } = openPage({ storage, hub, id: 'a', setting: 'workstation', browser });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.workstation);
    expect(loads.count).toBe(1);
  });

  it('不认得的值：警告一次，设定不变', async () => {
    const { storage, hub } = setup();
    const store = createDeviceStore(storage);
    applySceneTierQuery('?scene-tier=high', store);
    using warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const browser = applySceneTierQuery('?scene-tier=ultra', store);
    expect(warn).toHaveBeenCalledOnce();
    const { source } = openPage({ storage, hub, id: 'a', setting: 'low', browser });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.high);
  });

  it('改了设定和改部署文件一样：原来记的降档、别的页面的旧标记都不算，按新的设定重新开始', async () => {
    const { storage, hub, leaveMarker, marker, record } = setup();
    // 部署文件是高档时崩溃过、降到了标准档，别的页面还留着高档时的标记
    storage.setItem(
      `yzt.device.${RECORD}`,
      JSON.stringify({ configured: 'high', cap: 'standard', restorable: true, restoredBefore: false })
    );
    leaveMarker('b', 'high', false, 'high');
    const browser = applySceneTierQuery('?scene-tier=workstation', createDeviceStore(storage));

    const { source } = openPage({ storage, hub, id: 'a', setting: 'high', browser });
    await expect(open3d(source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.workstation);
    expect(source.notice.value).toBeNull();
    expect(record()).toBeNull();
    expect(marker('b')).toBeUndefined();
    expect(marker('a')).toStrictEqual({ tier: 'workstation', configured: 'workstation', restored: false });
  });

  it('设定下崩溃：降档按设定记；清掉设定、回到不同的部署文件时也清掉', async () => {
    const { storage, hub, record } = setup();
    const store = createDeviceStore(storage);
    const browser = applySceneTierQuery('?scene-tier=workstation', store);
    const crashed = openPage({ storage, hub, id: 'b', setting: 'high', browser });
    await open3d(crashed.source);
    crashed.crash();

    const after = openPage({ storage, hub, id: 'a', setting: 'high', browser });
    await expect(open3d(after.source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.high);
    expect(record()).toMatchObject({ configured: 'workstation', cap: 'high' });

    const cleared = applySceneTierQuery('?scene-tier=default', store);
    const back = openPage({ storage, hub, id: 'c', setting: 'standard', browser: cleared });
    await expect(open3d(back.source)).resolves.toStrictEqual(SCENE_TIER_BUDGETS.standard);
    expect(record()).toBeNull();
  });
});
