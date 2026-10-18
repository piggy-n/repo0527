import { LatestController, safeReporter } from '@yzt/utils';
import type { CameraModel } from '@yzt/map-core';
import { onActivated, onDeactivated, onMounted, onScopeDispose, type Ref, shallowRef, watch } from 'vue';

/** 预览画布的状态；后续 MapView 接入时由地图上下文统一持有 */
export type CesiumCanvasState =
  | { status: 'loading' | 'ready' }
  | { status: 'failed'; message: string };

/** Vue 层只持有生命周期，不暴露原生 Cesium 对象 */
export interface CesiumCanvasSurface extends Disposable {
  pause(): void;
  resume(): void;
}

/** 创建边界用于注入假画布，测试不模拟整个 SDK */
export interface CesiumCanvasOptions {
  container: HTMLElement;
  assetBaseUrl: string;
  camera?: CameraModel;
  active: boolean;
  onReady(): void;
  onError(error: unknown): void;
}

export type LoadCesiumSurface = () => Promise<(options: CesiumCanvasOptions) => CesiumCanvasSurface>;

/** 模块只在画布挂载时加载，二维入口不静态引用 Cesium */
const loadCesiumSurface: LoadCesiumSurface = async () => {
  const { CesiumSurface } = await import('@yzt/map-cesium');
  return options => new CesiumSurface(options);
};

/** 管理预览画布的懒加载、重试和隐藏生命周期 */
export function useCesiumCanvas(
  container: Ref<HTMLElement | undefined>,
  assetBaseUrl: () => string,
  active: () => boolean,
  load: LoadCesiumSurface = loadCesiumSurface,
  camera?: CameraModel
) {
  const state = shallowRef<CesiumCanvasState>({ status: 'loading' });
  const operation = new LatestController();
  const report = safeReporter(console.error, 'CesiumCanvas');
  let surface: CesiumCanvasSurface | undefined;
  let mounted = false;
  let deactivated = false;
  let disposed = false;

  const release = () => {
    const previous = surface;
    surface = undefined;
    try {
      previous?.[Symbol.dispose]();
    } catch (error) {
      report(error);
    }
  };

  const retry = async () => {
    if (!mounted || disposed || !container.value) {
      return;
    }
    const signal = operation.next();
    release();
    state.value = { status: 'loading' };
    let failed = false;
    const fail = (error: unknown) => {
      if (!signal.aborted && !failed) {
        failed = true;
        release();
        state.value = { status: 'failed', message: error instanceof Error ? error.message : String(error) };
      }
    };
    try {
      const create = await load();
      if (signal.aborted || !container.value) {
        return;
      }
      surface = create({
        container: container.value,
        assetBaseUrl: assetBaseUrl(),
        camera,
        active: active() && !deactivated,
        onReady: () => {
          if (!signal.aborted && state.value.status === 'loading') {
            state.value = { status: 'ready' };
          }
        },
        onError: fail
      });
      if (signal.aborted || failed) {
        release();
      } else if (!active() || deactivated) {
        surface.pause();
      }
    } catch (error) {
      fail(error);
    }
  };

  // 暂停不丢弃实例，恢复按当前容器尺寸重新渲染
  const updateActive = () => {
    try {
      if (!active() || deactivated) {
        surface?.pause();
      } else {
        surface?.resume();
      }
    } catch (error) {
      operation.abort();
      release();
      state.value = { status: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  };

  onMounted(() => {
    mounted = true;
    void retry();
  });
  watch(assetBaseUrl, () => { void retry(); });
  watch(active, updateActive);
  onDeactivated(() => { deactivated = true; updateActive(); });
  onActivated(() => { deactivated = false; updateActive(); });
  onScopeDispose(() => {
    disposed = true;
    operation[Symbol.dispose]();
    release();
  });

  return { state, retry };
}
