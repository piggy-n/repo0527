import type { SourceActivity } from '@mx/map-core';
import type { IconName } from '../../icons/SvgIcon';

// 地图数据的请求状态（ADR 0158）：状态栏右边的条目和点开的明细，二维瓦片按数据源、三维模型按模型；接口请求不算

/** 加载超过这么久才显示（毫秒）：快的请求不打扰 */
export const SHOW_DELAY = 400;
/** 显示过的加载结束后，"已加载完成"留多久（毫秒） */
export const DONE_HOLD = 1500;
/** 加载超过这么久在明细里写等了几秒（毫秒） */
export const SLOW_AFTER = 5000;

/** 一项的来源：页面从各拥有者推导出来交给 useRequestStatus */
export type RequestSource =
  /** 瓦片：一个或几个数据源这一轮的请求合在一起 */
  | {
      readonly kind: 'tiles';
      readonly key: string;
      readonly name: string;
      readonly icon: IconName;
      readonly activity: SourceActivity;
    }
  /** 三维模型：只有加载中、就绪、失败，时间由 useRequestStatus 按状态变化记下 */
  | {
      readonly kind: 'model';
      readonly key: string;
      readonly name: string;
      readonly icon: IconName;
      readonly state: 'loading' | 'ready' | 'failed';
    };

/** 明细里的一项 */
export interface RequestItem {
  readonly key: string;
  readonly kind: 'tiles' | 'model';
  readonly name: string;
  readonly icon: IconName;
  /** 瓦片的张数；模型都是 0 */
  readonly requested: number;
  readonly loaded: number;
  readonly failed: number;
  readonly startedAt: number;
  /** 还在加载时为 null */
  readonly finishedAt: number | null;
}

/** 状态栏的条目：空闲时不显示 */
export type RequestSummary =
  | { readonly kind: 'hidden' }
  /** ratio 是加载中的瓦片完成了多少（0～1），只有模型在加载时为 null；withFailures 是同时有失败的 */
  | { readonly kind: 'loading'; readonly count: number; readonly ratio: number | null; readonly withFailures: number }
  | { readonly kind: 'failed'; readonly count: number }
  | { readonly kind: 'done' };

export const isPending = (item: RequestItem): boolean => item.finishedAt === null;

// 显示过的：加载超过 SHOW_DELAY 的
const wasShown = (item: RequestItem, now: number): boolean => (item.finishedAt ?? now) - item.startedAt > SHOW_DELAY;

/**
 * 状态栏的条目（原型 DESIGN.v1"请求状态"）：有加载超过 0.4 秒的时显示加载中、几项和完成的比例；没有在显示的加载、有失败时
 * 显示几项失败，直到下一轮请求把失败清掉；显示过的加载结束后 1.5 秒内显示"已加载完成"；明细开着时至少显示"已加载完成"
 */
export function requestSummary(items: readonly RequestItem[], now: number, open = false): RequestSummary {
  const pending = items.filter(isPending);
  const failed = items.filter(item => item.failed > 0);
  if (pending.some(item => wasShown(item, now))) {
    const tiles = pending.filter(item => item.kind === 'tiles' && item.requested > 0);
    const requested = tiles.reduce((sum, item) => sum + item.requested, 0);
    const finished = tiles.reduce((sum, item) => sum + item.loaded + item.failed, 0);
    return {
      kind: 'loading',
      count: pending.length,
      ratio: requested > 0 ? finished / requested : null,
      withFailures: failed.length
    };
  }
  if (failed.length > 0) {
    return { kind: 'failed', count: failed.length };
  }
  const recent = items.some(
    item => item.finishedAt !== null && wasShown(item, now) && now - item.finishedAt < DONE_HOLD
  );
  return recent || open ? { kind: 'done' } : { kind: 'hidden' };
}

/** 明细的三组：加载中、有失败（已经结束的）、已完成；组内按开始的先后 */
export function requestGroups(items: readonly RequestItem[]): {
  readonly loading: readonly RequestItem[];
  readonly failed: readonly RequestItem[];
  readonly done: readonly RequestItem[];
} {
  const sorted = items.toSorted((a, b) => a.startedAt - b.startedAt);
  return {
    loading: sorted.filter(isPending),
    failed: sorted.filter(item => !isPending(item) && item.failed > 0),
    done: sorted.filter(item => !isPending(item) && item.failed === 0)
  };
}

/** 明细里一项的状态文字和进度（0～1，没有进度时为 null）；tone 决定颜色 */
export function requestRowText(
  item: RequestItem,
  now: number
): { readonly text: string; readonly progress: number | null; readonly tone: 'normal' | 'slow' | 'error'; readonly waited: number | null } {
  if (item.kind === 'model') {
    if (item.failed > 0) {
      return { text: '加载失败', progress: null, tone: 'error', waited: null };
    }
    return { text: isPending(item) ? '读取模型…' : '已完成', progress: null, tone: 'normal', waited: null };
  }
  const finished = item.loaded + item.failed;
  if (isPending(item)) {
    const elapsed = now - item.startedAt;
    const slow = elapsed > SLOW_AFTER;
    return {
      text: `${finished}/${item.requested} 张`,
      progress: item.requested > 0 ? finished / item.requested : 0,
      tone: slow ? 'slow' : 'normal',
      waited: slow ? Math.round(elapsed / 1000) : null
    };
  }
  if (item.failed > 0) {
    return { text: `${item.failed} 张失败`, progress: null, tone: 'error', waited: null };
  }
  return { text: `${item.requested} 张`, progress: null, tone: 'normal', waited: null };
}

/**
 * 几个数据源这一轮的请求合成一项：从最早开始，都结束时才结束。张数、开始和结束只算最近一段：按开始的先后连起时间上重叠的，
 * 和最后一段不重叠的（上一轮早已结束、结果还留着的数据源，如打开地名时的底图）不算，免得开始时间拉到几分钟前；
 * 失败的张数算全部数据源的，失败按数据源显示到它的下一次请求为止（ADR 0158）
 */
export function mergedActivity(activities: readonly SourceActivity[]): SourceActivity | null {
  if (activities.length === 0) {
    return null;
  }
  // 最近一段：按开始的先后往后走，开始得比前面那段的结束还晚的就断开，重新开始一段
  let latest: SourceActivity[] = [];
  let end = -Infinity;
  for (const activity of activities.toSorted((a, b) => a.startedAt - b.startedAt)) {
    if (activity.startedAt > end) {
      latest = [];
    }
    latest.push(activity);
    end = Math.max(end, activity.finishedAt ?? Infinity);
  }
  const pending = latest.some(activity => activity.finishedAt === null);
  return {
    requested: latest.reduce((sum, activity) => sum + activity.requested, 0),
    loaded: latest.reduce((sum, activity) => sum + activity.loaded, 0),
    failed: activities.reduce((sum, activity) => sum + activity.failed, 0),
    startedAt: Math.min(...latest.map(activity => activity.startedAt)),
    finishedAt: pending ? null : Math.max(...latest.map(activity => activity.finishedAt ?? 0))
  };
}
