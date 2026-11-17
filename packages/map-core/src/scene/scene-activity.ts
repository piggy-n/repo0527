import type { SourceActivity } from '../view/source-activity';

/**
 * 一个瓦片集或高斯泼溅读完索引以后、随相机流式加载的这一轮（ADR 0162）：瓦片集按块数，同二维的 SourceActivity；
 * 高斯泼溅的库只给当前视角的细节到了多少，没有块数。结束后保留这一轮的结果，直到下一轮开始
 */
export type SceneActivity =
  | ({ readonly kind: 'blocks' } & SourceActivity)
  | {
      readonly kind: 'detail';
      /** 当前视角要的细节到了多少，0～1，随视角变 */
      readonly progress: number;
      /** 毫秒，同 performance.now；还在加载时没有结束时间 */
      readonly startedAt: number;
      readonly finishedAt: number | null;
    };

/** 键是瓦片集、高斯泼溅的 ID（同 SceneStatus）；每次变化换一个新的 Map */
export type SceneActivities = ReadonlyMap<string, SceneActivity>;

/** 没有在加载、也没有记下的模型 */
export const NO_SCENE_ACTIVITY: SceneActivities = new Map();
