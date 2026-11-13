import { z } from 'zod';
import { SCENE_TIER_SETTINGS, SCENE_TIERS, type SceneTierSetting } from '../../config/scene-tier-options';
import type { DeviceStore } from '../../storage/device-store';
import type { PingMessage } from './scene-tier-ping-protocol';

// 崩溃标记和这台设备记的降档（ADR 0155 第 4 节，做法见 docs/config/scene-tier.md"崩溃标记"）：
// 每个页面一个键，各写各的，没有跨页面的"读、改、写"

const MARKER_PREFIX = 'scene-tier:page:';
const RECORD_KEY = 'scene-tier:record';

const markerSchema = z.object({
  tier: z.enum(SCENE_TIERS),
  /** 写标记时 scene-tier.json 里的档位：部署方改了配置以后，改之前的标记不算 */
  configured: z.enum(SCENE_TIER_SETTINGS),
  /** 这个页面恢复过画质：它再崩，说明恢复了马上又崩 */
  restored: z.boolean()
});

/** 一个页面的崩溃标记：三维开着、页面可见时才有 */
export type CrashMarker = z.infer<typeof markerSchema>;

const recordSchema = z.object({
  configured: z.enum(SCENE_TIER_SETTINGS),
  /** 崩溃降到的上限；恢复以后是 null */
  cap: z.enum(SCENE_TIERS).nullable(),
  /** 提示里给不给"恢复"：恢复过的页面又崩时不给 */
  restorable: z.boolean(),
  /** 用户恢复过：再崩时提示里注明"恢复后又崩溃过" */
  restoredBefore: z.boolean()
});

/** 这台设备记的降档 */
export type TierRecord = z.infer<typeof recordSchema>;

const pingMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ping') }),
  z.object({ kind: z.literal('alive'), id: z.string() }),
  z.object({ kind: z.literal('removed'), id: z.string() })
]);

/** 广播频道的窄接口：BroadcastChannel 满足它，测试用内存里的 */
export interface PingChannel {
  postMessage(message: PingMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

function post(channel: PingChannel, message: PingMessage): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel 的 postMessage 没有 targetOrigin
  channel.postMessage(message);
}

// 别的页面发来的消息要校验；不认识的不管
function listen(channel: PingChannel, onMessage: (message: PingMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    const parsed = pingMessageSchema.safeParse(event.data);
    if (parsed.success) {
      onMessage(parsed.data);
    }
  };
  channel.addEventListener('message', listener);
  return () => channel.removeEventListener('message', listener);
}

/** 写或删（null）自己的标记 */
export function writeMarker(store: DeviceStore, id: string, marker: CrashMarker | null): void {
  if (marker === null) {
    store.remove(MARKER_PREFIX + id);
  } else {
    store.set(MARKER_PREFIX + id, marker);
  }
}

/** 读这台设备记的降档：配置里的档位变了就清掉，重新从配置开始 */
export function readRecord(store: DeviceStore, configured: SceneTierSetting): TierRecord | undefined {
  const record = store.get(RECORD_KEY, recordSchema);
  if (record !== undefined && record.configured !== configured) {
    store.remove(RECORD_KEY);
    return undefined;
  }
  return record;
}

export function writeRecord(store: DeviceStore, record: TierRecord): void {
  store.set(RECORD_KEY, record);
}

/** 检查的页面删了这个页面的标记（判断错了）：收到后补写 */
export function onMarkerRemoved(channel: PingChannel, id: string, listener: () => void): () => void {
  return listen(channel, message => {
    if (message.kind === 'removed' && message.id === id) {
      listener();
    }
  });
}

// 问一次还在不在，等到它们都回答或者超时；返回没回答的
function silentPages(channel: PingChannel, ids: ReadonlySet<string>, timeoutMs: number): Promise<Set<string>> {
  const waiting = new Set(ids);
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      stop();
      resolve(waiting);
    };
    const stop = listen(channel, message => {
      if (message.kind === 'alive' && waiting.delete(message.id) && waiting.size === 0) {
        finish();
      }
    });
    const timer = setTimeout(finish, timeoutMs);
    post(channel, { kind: 'ping' });
  });
}

/**
 * 找出崩溃了的页面：别的页面留下的标记，问一次还在不在，超时没回答的算崩溃，马上删掉它的键并广播一次
 * （它其实还在、只是没答上时收到后补写）。没有别的页面的键时不问、不等。配置里的档位不同的旧标记直接删掉，不算
 */
export async function findCrashed(
  store: DeviceStore,
  channel: PingChannel,
  selfId: string,
  configured: SceneTierSetting,
  timeoutMs: number
): Promise<CrashMarker[]> {
  const others = new Map<string, CrashMarker>();
  for (const key of store.keys(MARKER_PREFIX)) {
    const id = key.slice(MARKER_PREFIX.length);
    const marker = id === selfId ? undefined : store.get(key, markerSchema);
    if (marker?.configured === configured) {
      others.set(id, marker);
    } else if (marker !== undefined) {
      store.remove(key);
    }
  }
  if (others.size === 0) {
    return [];
  }
  const silent = await silentPages(channel, new Set(others.keys()), timeoutMs);
  const crashed: CrashMarker[] = [];
  for (const [id, marker] of others) {
    if (silent.has(id)) {
      store.remove(MARKER_PREFIX + id);
      post(channel, { kind: 'removed', id });
      crashed.push(marker);
    }
  }
  return crashed;
}
