import { LatestController, safeReporter } from '@yzt/utils';
import type { MapSession, MapView } from '@yzt/map-core';
import { onActivated, onDeactivated, onMounted, onScopeDispose, type Ref, shallowRef, watch } from 'vue';
import type { MapContextState } from './context';

/** 开发画布的加载反馈；就绪视口和引擎失败同时由地图上下文持有 */
export type CesiumCanvasState =
  | { status: 'loading' | 'ready' }
  | { status: 'failed'; message: string };

/** Vue 层只持有生命周期，不暴露原生 Cesium 对象 */
export type CesiumCanvasSurface = MapView;

/** 创建边界用于注入假画布，测试不模拟整个 SDK */
export interface CesiumCanvasOptions {
  container: HTMLElement;
  assetBaseUrl: string;
  session?: MapSession<string>;
  active: boolean;
  onReady(): void;
  onError(error: unknown): void;
}

export type LoadCesiumSurface = () => Promise<(options: CesiumCanvasOptions) => CesiumCanvasSurface>;

/** 模块只在画布挂载时加载，二维入口不静态引用 Cesium */
const loadCesiumSurface: LoadCesiumSurface = async () => {
  const { CesiumView } = await import('@yzt/map-cesium');
  return options => {
    if (!options.session) {
      throw new Error('CesiumCanvas 需要地图会话');
    }
    // onError 也包含单层诊断，只有视图失败或就绪等待失败才改变画布的加载反馈
    const view = new CesiumView({ ...options, session: options.session, onError: console.error });
    view.on('statechange', state => {
      if (state === 'failed') {
        options.onError(view.failure?.error);
      }
    });
    void view.whenReady().then(() => options.onReady(), error => options.onError(error));
    return view;
  };
};

/** 管理预览画布的懒加载、重试和隐藏生命周期 */
export function useCesiumCanvas(
  container: Ref<HTMLElement | undefined>,
  assetBaseUrl: () => string,
  active: () => boolean,
  load: LoadCesiumSurface = loadCesiumSurface,
  map?: MapContextState
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
      if (previous) {
        map?.detachView(previous);
      }
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
        session: map?.session,
        active: active() && !deactivated,
        onReady: () => {
          if (!signal.aborted && state.value.status === 'loading') {
            state.value = { status: 'ready' };
          }
        },
        onError: fail
      });
      if (signal.aborted) {
        release();
        return;
      }
      // 引擎失败的实例仍挂在上下文上，供公共状态提示和 retry 使用
      map?.attachView(surface, container.value);
      if (!active() || deactivated) {
        surface.pause();
      }
    } catch (error) {
      release();
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
  if (map) {
    watch(map.retryRequests, () => { void retry(); });
  }
  onDeactivated(() => { deactivated = true; updateActive(); });
  onActivated(() => { deactivated = false; updateActive(); });
  onScopeDispose(() => {
    disposed = true;
    operation[Symbol.dispose]();
    release();
  });

  return { state, retry };
}
