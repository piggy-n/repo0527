/**
 * 一个数据源这一轮的瓦片请求（ADR 0158）：空闲以后请求第一张瓦片时开始新的一轮，所有瓦片都到了（或失败、取消）时结束；
 * 结束后保留这一轮的结果，直到下一轮开始。只统计新请求的瓦片，已有瓦片的重新加载不算
 */
export interface SourceActivity {
  /** 这一轮请求的瓦片数：取消的不算 */
  readonly requested: number;
  /** 已经到了的，包括后端返回 404 的空瓦片 */
  readonly loaded: number;
  readonly failed: number;
  /** 这一轮开始、结束的时间（毫秒，同 performance.now）；还在请求时没有结束时间 */
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

/** 键是数据源 ID；每次变化换一个新的 Map */
export type SourceActivities = ReadonlyMap<string, SourceActivity>;

/** 没有在请求、也没有记下的数据源 */
export const NO_SOURCE_ACTIVITY: SourceActivities = new Map();

/** 这一轮还在请求 */
export function isActivityLoading(activity: SourceActivity): boolean {
  return activity.finishedAt === null;
}

// 一个数据源的计数：还在请求的瓦片按 MapLibre 的瓦片键记，同一张不重复算
interface Round {
  readonly pending: Set<string>;
  requested: number;
  loaded: number;
  failed: number;
  startedAt: number;
  finishedAt: number | null;
}

/** 瓦片请求的结果：到了、失败、取消（不再需要，不算这一轮的请求） */
export type TileOutcome = 'loaded' | 'failed' | 'aborted';

/**
 * 按数据源统计瓦片请求（ADR 0158）：适配器把引擎的瓦片事件交给它，它只计数，每次变化通知一次，由使用方决定多久读一次；
 * 读到的是不可变的快照
 */
export class SourceActivityTracker {
  readonly #rounds = new Map<string, Round>();
  readonly #now: () => number;
  readonly #onChange: () => void;
  #snapshot: SourceActivities = NO_SOURCE_ACTIVITY;
  #stale = false;

  constructor(onChange: () => void, now: () => number = () => performance.now()) {
    this.#onChange = onChange;
    this.#now = now;
  }

  /** 当前的快照：没有变化时是同一个对象 */
  get activities(): SourceActivities {
    if (this.#stale) {
      this.#stale = false;
      this.#snapshot =
        this.#rounds.size === 0
          ? NO_SOURCE_ACTIVITY
          : new Map(
              [...this.#rounds].map(([sourceId, { requested, loaded, failed, startedAt, finishedAt }]) => [
                sourceId,
                Object.freeze({ requested, loaded, failed, startedAt, finishedAt })
              ])
            );
    }
    return this.#snapshot;
  }

  /** 开始请求一张新的瓦片；数据源空闲时开始新的一轮 */
  started(sourceId: string, tileKey: string): void {
    let round = this.#rounds.get(sourceId);
    if (!round || round.pending.size === 0) {
      round = { pending: new Set(), requested: 0, loaded: 0, failed: 0, startedAt: this.#now(), finishedAt: null };
      this.#rounds.set(sourceId, round);
    }
    if (round.pending.has(tileKey)) {
      return;
    }
    round.pending.add(tileKey);
    round.requested++;
    this.#changed();
  }

  /** 一张瓦片有了结果；不是这一轮在等的（已有瓦片的重新加载）不算 */
  finished(sourceId: string, tileKey: string, outcome: TileOutcome): void {
    const round = this.#rounds.get(sourceId);
    if (!round?.pending.delete(tileKey)) {
      return;
    }
    if (outcome === 'aborted') {
      round.requested--;
    } else if (outcome === 'loaded') {
      round.loaded++;
    } else {
      round.failed++;
    }
    this.#finishIfDone(sourceId, round);
    this.#changed();
  }

  /**
   * 引擎说这个数据源没有在请求了：还在等的都算到了。后端返回 404 的空瓦片、没有变化的瓦片引擎不发事件，靠这里结束这一轮
   */
  settled(sourceId: string): void {
    const round = this.#rounds.get(sourceId);
    if (!round || round.pending.size === 0) {
      return;
    }
    round.loaded += round.pending.size;
    round.pending.clear();
    this.#finishIfDone(sourceId, round);
    this.#changed();
  }

  /** 引擎说所有数据源都没有在请求了（视野里的瓦片都到了） */
  settleAll(): void {
    for (const [sourceId, round] of this.#rounds) {
      if (round.pending.size > 0) {
        this.settled(sourceId);
      }
    }
  }

  /** 数据源移除、样式整体重建时忘掉它们；不传时全部忘掉 */
  forget(sourceIds?: readonly string[]): void {
    const forgotten = sourceIds ?? [...this.#rounds.keys()];
    let changed = false;
    for (const sourceId of forgotten) {
      changed = this.#rounds.delete(sourceId) || changed;
    }
    if (changed) {
      this.#changed();
    }
  }

  // 都有了结果时结束；全部取消、一张也没请求的一轮不留下
  #finishIfDone(sourceId: string, round: Round): void {
    if (round.pending.size > 0) {
      return;
    }
    if (round.requested === 0) {
      this.#rounds.delete(sourceId);
      return;
    }
    round.finishedAt = this.#now();
  }

  #changed(): void {
    this.#stale = true;
    this.#onChange();
  }
}
