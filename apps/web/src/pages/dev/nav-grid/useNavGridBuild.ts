import {
  buildNavigation,
  detectLevels,
  type NavBuildProgress,
  type Navigation,
  type NavLevel,
  planRegions,
  prepareTileset,
  type RegionPlan
} from '@yzt/map-core';
import { LatestController } from '@yzt/utils';
import { onScopeDispose, type Ref, shallowRef } from 'vue';

/** 建好的导航网格，连同楼层和区域着色 */
export interface NavGridResult {
  readonly modelId: string;
  readonly navigation: Navigation;
  readonly levels: readonly NavLevel[];
  readonly plan: RegionPlan;
  /** 从整理索引到着色完成的耗时（毫秒） */
  readonly elapsed: number;
  readonly tiles: number;
}

export type NavGridBuildState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'building'; readonly modelId: string; readonly progress: NavBuildProgress | null }
  | { readonly kind: 'ready'; readonly result: NavGridResult }
  | { readonly kind: 'failed'; readonly modelId: string; readonly error: unknown };

async function loadJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`索引下载失败（${response.status}）：${url}`);
  }
  return response.json();
}

/** 开发页的构建：换一个模型时作废上一次，页面卸载时中止 */
export function useNavGridBuild(): {
  readonly state: Readonly<Ref<NavGridBuildState>>;
  readonly build: (modelId: string, tilesetUrl: string) => Promise<void>;
} {
  const state = shallowRef<NavGridBuildState>({ kind: 'idle' });
  const latest = new LatestController();
  onScopeDispose(() => latest[Symbol.dispose]());

  const build = async (modelId: string, tilesetUrl: string) => {
    const signal = latest.next();
    const started = performance.now();
    let tiles = 0;
    state.value = { kind: 'building', modelId, progress: null };
    try {
      const prepared = await prepareTileset(tilesetUrl, loadJson, signal);
      signal.throwIfAborted();
      const navigation = await buildNavigation(prepared, {
        signal,
        onProgress: progress => {
          if (!signal.aborted) {
            tiles = progress.stage === 'download' ? progress.total : tiles;
            state.value = { kind: 'building', modelId, progress };
          }
        }
      });
      signal.throwIfAborted();
      const levels = detectLevels(navigation.grid, { groundHeight: navigation.frame.ground });
      const plan = planRegions(navigation.grid, levels);
      state.value = {
        kind: 'ready',
        result: { modelId, navigation, levels, plan, elapsed: performance.now() - started, tiles }
      };
    } catch (error) {
      if (!signal.aborted) {
        state.value = { kind: 'failed', modelId, error };
      }
    }
  };
  return { state, build };
}
