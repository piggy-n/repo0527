import type { SceneActivity, SourceActivity } from '@mx/map-core';
import type { IconName } from '../../icons/SvgIcon';

// 地图数据的请求状态（ADR 0158）：状态栏右边的条目和点开的明细，二维瓦片按数据源、三维模型按模型；接口请求不算

/** 加载超过这么久才显示（毫秒）：快的请求不打扰 */
export const SHOW_DELAY = 400;
/** 显示过的加载结束后，"已加载完成"留多久（毫秒） */
export const DONE_HOLD = 1500;
/** 加载超过这么久在明细里写等了几秒（毫秒） */
export const SLOW_AFTER = 5000;
/**
 * 模型读完索引以后，渲染器在下一次选瓦片时才开始请求块或暂缓请求（ADR 0162）：两段相隔不到这么久算同一段，读完、还没有块时
 * 也等这么久再算结束，转圈和条目不闪（毫秒）。还没显示出来的读索引，等待不超过开始后 SHOW_DELAY，不会因为等这一下显示出来
 */
export const MODEL_SETTLE = 300;

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
  /** 三维模型：读索引只有加载中、就绪、失败，时间由 useRequestStatus 按状态变化记下；读完以后这一轮的加载由渲染器统计 */
  | {
      readonly kind: 'model';
      readonly key: string;
      readonly name: string;
      readonly icon: IconName;
      readonly state: 'loading' | 'ready' | 'failed';
      /** 读完索引以后这一轮的加载（ADR 0162）；还没请求过时为 null */
      readonly activity: SceneActivity | null;
    };

/**
 * 明细里的一项在等什么：二维的瓦片（张）；模型读索引、失败或读完以后没有请求（model）；瓦片集的块（blocks）；
 * 高斯泼溅当前视角的细节（detail，只有比例，和块数不是一种口径）
 */
export type RequestItemKind = 'tiles' | 'model' | 'blocks' | 'detail';

/** 明细里的一项 */
export interface RequestItem {
  readonly key: string;
  readonly kind: RequestItemKind;
  readonly name: string;
  readonly icon: IconName;
  /** 瓦片的张数、瓦片集的块数；读模型索引时没有张数，失败记 1；高斯泼溅都是 0 */
  readonly requested: number;
  readonly loaded: number;
  readonly failed: number;
  /** 高斯泼溅当前视角的细节到了多少（0～1）；其他为 null */
  readonly detail: number | null;
  readonly startedAt: number;
  /** 还在加载时为 null */
  readonly finishedAt: number | null;
}

/** 模型读索引的阶段：useRequestStatus 按状态变化记下开始、结束的时间 */
export interface ModelPhase {
  readonly state: 'loading' | 'ready' | 'failed';
  readonly startedAt: number;
  /** 还在读索引时为 null */
  readonly finishedAt: number | null;
}

/**
 * 明细里的一个模型（ADR 0158、0162）：失败、读索引时按读索引的阶段；读完以后有这一轮的加载时按它，和读完相隔不到 MODEL_SETTLE 的
 * 从读索引开始算（同一段，转圈不闪）；读完、还没请求时再等 MODEL_SETTLE 才算结束。在这一段开始以前就结束的一轮是上次显示时的，不算
 */
export function modelRequestItem(
  { key, name, icon }: Pick<RequestItem, 'key' | 'name' | 'icon'>,
  phase: ModelPhase,
  activity: SceneActivity | null,
  now: number
): RequestItem {
  const common = { key, name, icon, detail: null };
  const readAt = phase.finishedAt;
  if (phase.state !== 'ready' || readAt === null) {
    const failed = phase.state === 'failed' ? 1 : 0;
    return { ...common, kind: 'model', requested: 0, loaded: 0, failed, startedAt: phase.startedAt, finishedAt: readAt };
  }
  const current = activity && (activity.finishedAt === null || activity.finishedAt >= phase.startedAt) ? activity : null;
  if (!current) {
    // 读索引已经显示出来（超过 SHOW_DELAY）的等到读完后 MODEL_SETTLE；还没显示的最多等到开始后 SHOW_DELAY，不因为等这一下显示出来
    const until =
      readAt - phase.startedAt > SHOW_DELAY
        ? readAt + MODEL_SETTLE
        : Math.min(readAt + MODEL_SETTLE, phase.startedAt + SHOW_DELAY);
    const finishedAt = now < until ? null : readAt;
    return { ...common, kind: 'model', requested: 0, loaded: 1, failed: 0, startedAt: phase.startedAt, finishedAt };
  }
  const startedAt = current.startedAt <= readAt + MODEL_SETTLE ? phase.startedAt : current.startedAt;
  if (current.kind === 'blocks') {
    const { requested, loaded, failed, finishedAt } = current;
    return { ...common, kind: 'blocks', requested, loaded, failed, startedAt, finishedAt };
  }
  return {
    ...common,
    kind: 'detail',
    requested: 0,
    loaded: 0,
    failed: 0,
    detail: current.progress,
    startedAt,
    finishedAt: current.finishedAt
  };
}

/**
 * 显示哪几类（ADR 0167）：加载中、加载失败、加载完成。关掉的一类在状态栏的条目、明细、行内都不显示，数据照常统计；
 * 由页面按用户的提示设置给出
 */
export interface RequestKinds {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly done: boolean;
}

export const ALL_REQUEST_KINDS: RequestKinds = { loading: true, failed: true, done: true };

/** 状态栏的条目：空闲时不显示 */
export type RequestSummary =
  | { readonly kind: 'hidden' }
  /**
   * ratio 是加载中的二维瓦片和瓦片集的块完成了多少（0～1），按张数、块数合起来算；只有读索引的模型、高斯泼溅在加载时为 null
   * （泼溅的比例不是请求数，不算进去，只算在项数里）；withFailures 是同时有失败的
   */
  | { readonly kind: 'loading'; readonly count: number; readonly ratio: number | null; readonly withFailures: number }
  | { readonly kind: 'failed'; readonly count: number }
  | { readonly kind: 'done' };

export const isPending = (item: RequestItem): boolean => item.finishedAt === null;

// 显示过的：加载超过 SHOW_DELAY 的
const wasShown = (item: RequestItem, now: number): boolean => (item.finishedAt ?? now) - item.startedAt > SHOW_DELAY;

/**
 * 状态栏的条目（原型 DESIGN.v1"请求状态"）：有加载超过 0.4 秒的时显示加载中、几项和完成的比例；没有在显示的加载、有失败时
 * 显示几项失败，直到下一轮请求把失败清掉；显示过的加载结束后 1.5 秒内显示"已加载完成"；明细开着时至少显示"已加载完成"。
 * 关掉的一类不算（ADR 0167）：都关掉时不显示
 */
export function requestSummary(
  items: readonly RequestItem[],
  now: number,
  open = false,
  kinds: RequestKinds = ALL_REQUEST_KINDS
): RequestSummary {
  const pending = kinds.loading ? items.filter(isPending) : [];
  const failed = kinds.failed ? items.filter(item => item.failed > 0) : [];
  if (pending.some(item => wasShown(item, now))) {
    const counted = pending.filter(item => (item.kind === 'tiles' || item.kind === 'blocks') && item.requested > 0);
    const requested = counted.reduce((sum, item) => sum + item.requested, 0);
    const finished = counted.reduce((sum, item) => sum + item.loaded + item.failed, 0);
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
  if (!kinds.done) {
    return { kind: 'hidden' };
  }
  const recent = items.some(
    item => item.finishedAt !== null && item.failed === 0 && wasShown(item, now) && now - item.finishedAt < DONE_HOLD
  );
  return recent || open ? { kind: 'done' } : { kind: 'hidden' };
}

/** 明细的三组：加载中、有失败（已经结束的）、已完成；组内按开始的先后。关掉的一类是空的（ADR 0167） */
export function requestGroups(
  items: readonly RequestItem[],
  kinds: RequestKinds = ALL_REQUEST_KINDS
): {
  readonly loading: readonly RequestItem[];
  readonly failed: readonly RequestItem[];
  readonly done: readonly RequestItem[];
} {
  const sorted = items.toSorted((a, b) => a.startedAt - b.startedAt);
  return {
    loading: kinds.loading ? sorted.filter(isPending) : [],
    failed: kinds.failed ? sorted.filter(item => !isPending(item) && item.failed > 0) : [],
    done: kinds.done ? sorted.filter(item => !isPending(item) && item.failed === 0) : []
  };
}

/** 明细里有失败、已经结束的项（ADR 0167）：行内的"加载失败"用同一份，下一轮请求开始时清掉 */
export function failedRequestKeys(items: readonly RequestItem[]): ReadonlySet<string> {
  return new Set(items.filter(item => !isPending(item) && item.failed > 0).map(item => item.key));
}

/** 明细里一行的状态 */
export interface RequestRowText {
  readonly text: string;
  /** 进度条（0～1）；没有进度时为 null */
  readonly progress: number | null;
  /** 决定颜色 */
  readonly tone: 'normal' | 'slow' | 'error';
  /** 等了几秒（超过 SLOW_AFTER 才有） */
  readonly waited: number | null;
}

// 加载中：超过 SLOW_AFTER 写等了几秒
function pendingRow(item: RequestItem, now: number, text: string, progress: number): RequestRowText {
  const elapsed = now - item.startedAt;
  const slow = elapsed > SLOW_AFTER;
  return { text, progress, tone: slow ? 'slow' : 'normal', waited: slow ? Math.round(elapsed / 1000) : null };
}

/**
 * 明细里一项的状态文字和进度：二维瓦片按张、瓦片集按块写"34/52"；高斯泼溅写"当前视角细节 62%"（ADR 0162）；
 * 读模型索引写"读取模型…"
 */
export function requestRowText(item: RequestItem, now: number): RequestRowText {
  if (item.kind === 'model') {
    if (item.failed > 0) {
      return { text: '加载失败', progress: null, tone: 'error', waited: null };
    }
    return { text: isPending(item) ? '读取模型…' : '已完成', progress: null, tone: 'normal', waited: null };
  }
  if (item.kind === 'detail') {
    const ratio = item.detail ?? 0;
    return isPending(item)
      ? pendingRow(item, now, `当前视角细节 ${Math.round(ratio * 100)}%`, ratio)
      : { text: '已完成', progress: null, tone: 'normal', waited: null };
  }
  const unit = item.kind === 'blocks' ? '块' : '张';
  const finished = item.loaded + item.failed;
  if (isPending(item)) {
    return pendingRow(item, now, `${finished}/${item.requested} ${unit}`, item.requested > 0 ? finished / item.requested : 0);
  }
  if (item.failed > 0) {
    return { text: `${item.failed} ${unit}失败`, progress: null, tone: 'error', waited: null };
  }
  return { text: `${item.requested} ${unit}`, progress: null, tone: 'normal', waited: null };
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
