// @vitest-environment node
import type { SceneBudget } from '@mx/map-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SCENE_TIER_BUDGETS, type SceneTier, type SceneTierSetting } from '../../config/scene-tier-options';
import { createDeviceStore, type DeviceStore } from '../../storage/device-store';
import type { PingChannel } from './crash-markers';
import { SceneTierSource } from './scene-tier';
import type { PingMessage } from './scene-tier-ping-protocol';

const DGPU = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const IGPU = 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)';

// 内存里的 localStorage
class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}

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

afterEach(() => {
  for (const disposable of disposables.splice(0)) {
    disposable[Symbol.dispose]();
  }
});

interface PageOptions {
  readonly storage: Storage;
  readonly hub: ReturnType<typeof createHub>;
  readonly id: string;
  readonly setting?: SceneTierSetting;
  readonly answerTimeoutMs?: number;
}

// 一个页面：自己的档位来源，Worker 就绪后替它回答
function openPage({ storage, hub, id, setting = 'auto', answerTimeoutMs = 20 }: PageOptions) {
  const store: DeviceStore = createDeviceStore(storage);
  const lifecycle = fakeLifecycle();
  let stopAnswering: (() => void) | undefined;
  const channel = hub.channel();
  const source = new SceneTierSource({
    store,
    channel,
    lifecycle,
    startPing: async pageId => {
      stopAnswering = hub.answerFor(pageId);
    },
    loadSetting: async () => setting,
    pageId: id,
    answerTimeoutMs
  });
  disposables.push(source);
  return {
    source,
    lifecycle,
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

// 别的页面以高档崩溃过，这个页面打开三维发现了
async function crashedOnce(restored = false) {
  const context = setup();
  context.leaveMarker('b', 'high', restored, 'high');
  const page = openPage({ storage: context.storage, hub: context.hub, id: 'a', setting: 'high' });
  await open3d(page.source);
  return { ...context, ...page };
}

describe('SceneTierSource 的档位', () => {
  it.each([
    ['auto、独显', 'auto', DGPU, 'standard'],
    ['auto、集显', 'auto', IGPU, 'low'],
    ['auto、读不到型号', 'auto', '', 'standard'],
    ['配置写了高档', 'high', IGPU, 'high'],
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
