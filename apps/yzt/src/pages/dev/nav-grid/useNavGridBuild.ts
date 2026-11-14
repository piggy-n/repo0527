import { detectLevels, type NavBuildProgress, type Navigation, type NavLevel, planRegions, type RegionPlan } from '@mx/map-core';
import { LatestController } from '@mx/utils';
import { onScopeDispose, type Ref, shallowRef } from 'vue';
import type { SceneModel } from '@/features/scene-models/catalog';
import { loadNavigation, loadSplatNavigation } from '@/features/scene-models/navigation';

/** 建好的导航网格，连同楼层和区域着色 */
export interface NavGridResult {
  readonly modelId: string;
  readonly navigation: Navigation;
  readonly levels: readonly NavLevel[];
  readonly plan: RegionPlan;
  /** 从读索引到着色完成的耗时（毫秒） */
  readonly elapsed: number;
  /** 下载的文件数：瓦片集是叶节点瓦片，高斯泼溅是碰撞网格 */
  readonly files: number;
  /** 高斯泼溅的碰撞网格太多、只读了出生点附近（ADR 0156 第 2 节）；瓦片集为 false */
  readonly partial: boolean;
}

export type NavGridBuildState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'building'; readonly modelId: string; readonly progress: NavBuildProgress | null }
  | { readonly kind: 'ready'; readonly result: NavGridResult }
  | { readonly kind: 'failed'; readonly modelId: string; readonly error: unknown };

/** 开发页的构建：瓦片集和高斯泼溅都用拥有者的那一套；换一个模型时作废上一次，页面卸载时中止 */
export function useNavGridBuild(): {
  readonly state: Readonly<Ref<NavGridBuildState>>;
  readonly build: (model: SceneModel) => Promise<void>;
} {
  const state = shallowRef<NavGridBuildState>({ kind: 'idle' });
  const latest = new LatestController();
  onScopeDispose(() => latest[Symbol.dispose]());

  const build = async (model: SceneModel) => {
    const signal = latest.next();
    const started = performance.now();
    const modelId = model.id;
    let files = 0;
    state.value = { kind: 'building', modelId, progress: null };
    const onProgress = (progress: NavBuildProgress) => {
      if (!signal.aborted) {
        files = progress.stage === 'download' ? progress.total : files;
        state.value = { kind: 'building', modelId, progress };
      }
    };
    try {
      const effect = model.effects.find(item => item.id === model.defaultEffect) ?? model.effects.at(0);
      let navigation: Navigation;
      let partial = false;
      if (model.splat) {
        const scan = await loadSplatNavigation(model.splat, model.spawn, { signal, onProgress });
        navigation = scan;
        partial = scan.partial;
      } else if (effect) {
        navigation = await loadNavigation(effect.url, { signal, onProgress });
      } else {
        throw new Error(`模型 ${modelId} 没有瓦片集`);
      }
      signal.throwIfAborted();
      const levels = detectLevels(navigation.grid, { groundHeight: navigation.frame.ground });
      const plan = planRegions(navigation.grid, levels);
      state.value = {
        kind: 'ready',
        result: { modelId, navigation, levels, plan, elapsed: performance.now() - started, files, partial }
      };
    } catch (error) {
      if (!signal.aborted) {
        state.value = { kind: 'failed', modelId, error };
      }
    }
  };
  return { state, build };
}
