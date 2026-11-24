import type { SceneActivity, SourceActivity } from '@mx/map-core';
import type { IconName } from '../../icons/SvgIcon';

// 地图数据的请求状态（ADR 0158）：状态栏右边的条目和点开的明细，二维瓦片按数据源、三维模型按模型；接口请求不算

/** 图层名称后面的转圈：加载超过这么久才显示（毫秒），快的请求不打扰 */
export const INLINE_DELAY = 400;
/** 状态栏的条目：有加载超过这么久才出现（毫秒，用户 2026-11-22 从 0.4 秒改成 0.8 秒） */
export const CHIP_DELAY = 800;
/**
 * 条目显示着的加载都结束后，"已加载完成"留多久（毫秒）：结束不早于出现，所以条目出现以后至少留这么久（用户 2026-11-22）
 */
export const DONE_HOLD = 1500;
/** 加载超过这么久在明细里写等了几秒（毫秒） */
export const SLOW_AFTER = 5000;
/**
 * 模型读完索引以后，渲染器在下一次选瓦片时才开始请求块或暂缓请求（ADR 0162）：两段相隔不到这么久算同一段，读完、还没有块时
 * 也等这么久再算结束，转圈和条目不闪（毫秒）。等待不越过读索引还没到的下一道门槛（INLINE_DELAY、CHIP_DELAY），
 * 不会因为等这一下显示出来
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
  /**
   * 上一轮结束时失败的张数、块数：这一轮还在加载时留着，其他时候为 0（失败留到下一轮结束才更新，用户 2026-11-22）；
   * 只有二维瓦片和瓦片集的块有，由 withPreviousFailures 填上
   */
  readonly previousFailed: number;
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
  const common = { key, name, icon, detail: null, previousFailed: 0 };
  const readAt = phase.finishedAt;
  if (phase.state !== 'ready' || readAt === null) {
    const failed = phase.state === 'failed' ? 1 : 0;
    return { ...common, kind: 'model', requested: 0, loaded: 0, failed, startedAt: phase.startedAt, finishedAt: readAt };
  }
  const current = activity && (activity.finishedAt === null || activity.finishedAt >= phase.startedAt) ? activity : null;
  if (!current) {
    // 等到读完后 MODEL_SETTLE，但不越过读索引还没到的下一道门槛（行内转圈、条目）：不因为等这一下显示出来
    const threshold = [INLINE_DELAY, CHIP_DELAY].find(delay => readAt - phase.startedAt <= delay);
    const until =
      threshold === undefined ? readAt + MODEL_SETTLE : Math.min(readAt + MODEL_SETTLE, phase.startedAt + threshold);
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
 * 由页面按部署的开关（appConfig.layerHints）给出
 */
export interface RequestKinds {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly done: boolean;
}

export const ALL_REQUEST_KINDS: RequestKinds = { loading: true, failed: true, done: true };

/**
 * 状态栏前面的状态按钮（ADR 0171）：三类都关掉时不显示（hidden）；没有要说的时是空闲（idle，灰色的勾），按钮一直在，
 * 宽度固定，状态变了读数不动
 */
export type RequestSummary =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'idle' }
  /**
   * ratio 是加载中的二维瓦片和瓦片集的块完成了多少（0～1），按张数、块数合起来算；只有读索引的模型、高斯泼溅在加载时为 null
   * （泼溅的比例不是请求数，不算进去，只算在项数里）；withFailures 是同时有失败的
   */
  | { readonly kind: 'loading'; readonly count: number; readonly ratio: number | null; readonly withFailures: number }
  | { readonly kind: 'failed'; readonly count: number }
  | { readonly kind: 'done' };

export const isPending = (item: RequestItem): boolean => item.finishedAt === null;

/**
 * 有失败（用户 2026-11-22，失败留到下一轮结束才更新）：结束了的看这一轮；还在加载的看上一轮，这一轮的失败等它结束才算。
 * 条目、明细的"有失败"一组和行内的"有瓦片加载失败"都按它
 */
export const hasFailure = (item: RequestItem): boolean => (isPending(item) ? item.previousFailed : item.failed) > 0;

// 能留到下一轮结束的失败：二维瓦片和瓦片集的块；模型读索引失败后的重试是新的一次，不留
const carriesFailure = (item: RequestItem): boolean => item.kind === 'tiles' || item.kind === 'blocks';

/** 每项上一轮结束时失败的张数、块数，键是项的 key；没有失败的不记 */
export type FailureMemory = ReadonlyMap<string, number>;

/**
 * 记下各项结束的一轮有没有失败：结束了的按这一轮记或清掉，还在加载的不变；不在了的项、模型重新读索引时忘掉。
 * 内容没变时还是原来的对象
 */
export function nextFailureMemory(previous: FailureMemory, rounds: readonly RequestItem[]): FailureMemory {
  const next = new Map<string, number>();
  for (const item of rounds) {
    if (!carriesFailure(item)) {
      continue;
    }
    const failed = isPending(item) ? (previous.get(item.key) ?? 0) : item.failed;
    if (failed > 0) {
      next.set(item.key, failed);
    }
  }
  const same = next.size === previous.size && [...next].every(([key, failed]) => previous.get(key) === failed);
  return same ? previous : next;
}

/** 还在加载的项带上上一轮的失败（previousFailed）；其他项原样 */
export function withPreviousFailures(rounds: readonly RequestItem[], memory: FailureMemory): readonly RequestItem[] {
  return rounds.map(item => {
    const previousFailed = isPending(item) && carriesFailure(item) ? (memory.get(item.key) ?? 0) : 0;
    return previousFailed === item.previousFailed ? item : { ...item, previousFailed };
  });
}

/**
 * 状态栏的条目这一次显示（用户 2026-11-22，合并显示）：从出现到隐藏算一次。settledAt 是这一次里加载都结束的时候，
 * 还有在加载的时为 null
 */
export interface RequestDisplay {
  readonly settledAt: number | null;
}

// 这一次显示里还有在加载的
const SHOWING: RequestDisplay = Object.freeze({ settledAt: null });

/**
 * 条目的显示往下走一步：没在显示时，有加载超过 CHIP_DELAY 的才开始。显示着加载中、"已加载完成"留着的时候又开始的加载算同一次，
 * 直接回到加载中，不先隐藏；留着的是失败时不算（失败不跟着每一轮闪），新的加载照样要超过 CHIP_DELAY。加载都结束以后再留
 * DONE_HOLD 才结束，所以出现以后至少留 1.5 秒。按项算，不看显示哪几类；没有变化时还是原来的对象
 */
export function nextRequestDisplay(
  previous: RequestDisplay | null,
  items: readonly RequestItem[],
  now: number
): RequestDisplay | null {
  const pending = items.filter(isPending);
  if (previous && previous.settledAt === null) {
    return pending.length > 0 ? previous : { settledAt: now };
  }
  const due = pending.some(item => now - item.startedAt > CHIP_DELAY);
  if (pending.length > 0 && (due || (previous !== null && !items.some(hasFailure)))) {
    return SHOWING;
  }
  const settledAt = previous?.settledAt ?? null;
  return settledAt === null || now >= settledAt + DONE_HOLD ? null : previous;
}

const IDLE: RequestSummary = Object.freeze({ kind: 'idle' });

/**
 * 状态按钮（ADR 0158、0171）：这一次显示着加载中（nextRequestDisplay）、明细开着时，有在加载的就显示加载中、几项和完成的比例；
 * 没有在显示的加载、有失败（hasFailure）时显示几项失败，留到下一轮结束；这一次显示里加载都结束了显示"已加载完成"；
 * 其余时候空闲。关掉的一类不算（ADR 0167）：都关掉时不显示
 */
export function requestSummary(
  items: readonly RequestItem[],
  display: RequestDisplay | null,
  open = false,
  kinds: RequestKinds = ALL_REQUEST_KINDS
): RequestSummary {
  if (!kinds.loading && !kinds.failed && !kinds.done) {
    return { kind: 'hidden' };
  }
  const pending = kinds.loading ? items.filter(isPending) : [];
  const failed = kinds.failed ? items.filter(hasFailure) : [];
  if (pending.length > 0 && (display?.settledAt === null || open)) {
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
  // 关掉加载完成时没有"已加载完成"；关掉加载中、还有在加载的时也不说完成
  if (!kinds.done || (!kinds.loading && items.some(isPending))) {
    return IDLE;
  }
  // 这一次显示里要有成功结束的项（关掉加载失败时，都失败了不说完成）；项都移走了的留到这一次结束
  const settled = items.length === 0 || items.some(item => !isPending(item) && item.failed === 0);
  return display !== null && settled ? { kind: 'done' } : IDLE;
}

/** 状态按钮上的百分比：向下取整，还在加载时最多 99（瓦片都到了、模型还在读索引时也没完成） */
export function requestPercent(ratio: number): number {
  return Math.min(99, Math.floor(ratio * 100));
}

/** 状态按钮的读屏名称：按钮上只有图标和数字，全称写在这里（ADR 0171）；空闲时是按钮的名字 */
export function requestStatusText(summary: RequestSummary): string {
  if (summary.kind === 'loading') {
    const percent = summary.ratio === null ? '' : `，已完成 ${requestPercent(summary.ratio)}%`;
    const failures = summary.withFailures > 0 ? `；${summary.withFailures} 项有失败` : '';
    return `正在加载 ${summary.count} 项${percent}${failures}`;
  }
  if (summary.kind === 'failed') {
    return `${summary.count} 项加载失败`;
  }
  return summary.kind === 'done' ? '地图数据已加载完成' : '数据加载';
}

/** 状态按钮的 Tooltip：说明加上点了做什么 */
export function requestStatusTip(summary: RequestSummary): string {
  return summary.kind === 'idle' || summary.kind === 'hidden'
    ? '查看数据加载的明细'
    : `${requestStatusText(summary)}。点击查看明细`;
}

/**
 * 明细的三组：加载中、有失败（hasFailure）、已完成；组内按开始的先后。还在加载、带着上一轮失败的项在加载中、有失败两组里都有，
 * 有失败一组写上一轮的失败（failedRowText）。关掉的一类是空的（ADR 0167）
 */
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
    failed: kinds.failed ? sorted.filter(hasFailure) : [],
    done: kinds.done ? sorted.filter(item => !isPending(item) && item.failed === 0) : []
  };
}

/** 明细里有失败的项（ADR 0167）：行内的"有瓦片加载失败"用同一份，留到下一轮结束（用户 2026-11-22） */
export function failedRequestKeys(items: readonly RequestItem[]): ReadonlySet<string> {
  return new Set(items.filter(hasFailure).map(item => item.key));
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

/** 有失败一组里一行的状态：还在加载的写上一轮失败的张数、块数，留到这一轮结束（用户 2026-11-22）；结束了的同 requestRowText */
export function failedRowText(item: RequestItem, now: number): RequestRowText {
  if (!isPending(item)) {
    return requestRowText(item, now);
  }
  const unit = item.kind === 'blocks' ? '块' : '张';
  return { text: `${item.previousFailed} ${unit}失败`, progress: null, tone: 'error', waited: null };
}

/**
 * 几个数据源这一轮的请求合成一项：从最早开始，都结束时才结束。张数、开始和结束只算最近一段：按开始的先后连起时间上重叠的，
 * 和最后一段不重叠的（上一轮早已结束、结果还留着的数据源，如打开地名时的底图）不算，免得开始时间拉到几分钟前；
 * 失败的张数算全部数据源的，按数据源算到它的下一次请求为止（ADR 0158）；显示时再留到合起来的这一项下一轮结束（hasFailure）
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
