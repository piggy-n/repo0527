import { LatestController } from '@yzt/utils';
import { onScopeDispose, type Ref, shallowRef } from 'vue';
import { sharedRegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { type Calculator, createCalculator } from '../model/calculator';
import { loadDistrictAtlas } from '../model/districts';

/** 推演模型的加载状态：要先下载县界、建 95 个区县 */
export type SimulationModel =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly calculator: Calculator }
  | { readonly status: 'failed'; readonly error: unknown };

let shared: Promise<Calculator> | undefined;

// 整个应用共用一份：县界只下载一次，计算器的缓存也共用；失败时下次重新加载
function loadSharedCalculator(): Promise<Calculator> {
  shared ??= loadDistrictAtlas(sharedRegionBoundaryLoader())
    .then(createCalculator)
    .catch((error: unknown) => {
      shared = undefined;
      throw error;
    });
  return shared;
}

/** 加载推演模型；load 默认是共用的一份，测试注入 */
export function useSimulationModel(load: () => Promise<Calculator> = loadSharedCalculator): {
  readonly model: Readonly<Ref<SimulationModel>>;
  readonly retry: () => void;
} {
  const model = shallowRef<SimulationModel>({ status: 'loading' });
  const latest = new LatestController();
  onScopeDispose(() => latest[Symbol.dispose]());

  const run = async () => {
    const signal = latest.next();
    model.value = { status: 'loading' };
    try {
      const calculator = await load();
      if (!signal.aborted) {
        model.value = { status: 'ready', calculator };
      }
    } catch (error) {
      if (!signal.aborted) {
        model.value = { status: 'failed', error };
      }
    }
  };
  void run();

  return { model, retry: () => void run() };
}
