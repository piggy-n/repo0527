import {
  NO_SCENE_ACTIVITY,
  type SceneActivities,
  type SceneActivity,
  type SourceActivities,
  SourceActivityTracker,
  type TileProbe
} from '@mx/map-core';

// 一份高斯泼溅这一轮：最近一帧的比例和开始、结束的时间
interface DetailRound {
  progress: number;
  readonly startedAt: number;
  finishedAt: number | null;
}

/**
 * 渲染器这一轮的加载（ADR 0162）：瓦片集的块交给 SourceActivityTracker，按瓦片对象记、看瓦片的状态算结果；
 * 高斯泼溅每帧报一次在不在加载和细节的比例，变成加载中时开始新的一轮。快照不可变，没有变化时是同一个对象
 */
export class SceneActivityTracker {
  readonly #blocks: SourceActivityTracker;
  readonly #details = new Map<string, DetailRound>();
  readonly #now: () => number;
  readonly #onChange: () => void;
  #snapshot: SceneActivities = NO_SCENE_ACTIVITY;
  // 快照用的是哪一份块的统计；泼溅变了时另记
  #blocksSeen: SourceActivities | null = null;
  #detailsStale = false;

  constructor(onChange: () => void, now: () => number = () => performance.now()) {
    this.#onChange = onChange;
    this.#now = now;
    this.#blocks = new SourceActivityTracker(onChange, now);
  }

  get activities(): SceneActivities {
    const blocks = this.#blocks.activities;
    if (blocks === this.#blocksSeen && !this.#detailsStale) {
      return this.#snapshot;
    }
    this.#blocksSeen = blocks;
    this.#detailsStale = false;
    const tiles = [...blocks].map(([id, activity]): [string, SceneActivity] => [
      id,
      Object.freeze({ kind: 'blocks' as const, ...activity })
    ]);
    const splats = [...this.#details].map(([id, { progress, startedAt, finishedAt }]): [string, SceneActivity] => [
      id,
      Object.freeze({ kind: 'detail' as const, progress, startedAt, finishedAt })
    ]);
    const entries = [...tiles, ...splats];
    this.#snapshot = entries.length === 0 ? NO_SCENE_ACTIVITY : new Map(entries);
    return this.#snapshot;
  }

  /** 瓦片集的一块瓦片真正排进了下载队列，或因相机动着暂缓请求；probe 按瓦片的状态给出结果，由 sweep 调用 */
  requested(id: string, tile: object, probe: TileProbe): void {
    this.#blocks.started(id, tile, probe);
  }

  /** 看一眼还在等的块：渲染器每画完一帧调用，缓存移除、块失败时也在微任务里调用 */
  sweep(): void {
    this.#blocks.sweep();
  }

  /** 高斯泼溅这一帧在不在加载、当前视角的细节到了多少：不在加载了就结束这一轮，再加载时开始新的一轮 */
  detail(id: string, loading: boolean, progress: number): void {
    const round = this.#details.get(id);
    if (loading) {
      if (!round || round.finishedAt !== null) {
        this.#details.set(id, { progress, startedAt: this.#now(), finishedAt: null });
      } else if (round.progress !== progress) {
        round.progress = progress;
      } else {
        return;
      }
    } else if (round?.finishedAt === null) {
      round.finishedAt = this.#now();
    } else {
      return;
    }
    this.#detailsStale = true;
    this.#onChange();
  }

  /** 瓦片集、泼溅移除了：忘掉它这一轮 */
  forget(id: string): void {
    this.#blocks.forget([id]);
    if (this.#details.delete(id)) {
      this.#detailsStale = true;
      this.#onChange();
    }
  }
}
