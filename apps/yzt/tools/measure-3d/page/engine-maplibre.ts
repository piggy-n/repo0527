import { MapLibreView, type SceneSurface } from '@mx/map-core';
import type { CullWindow, ThreeSceneRenderer as Renderer } from '@mx/map-three';
import { setupMapRuntime } from '../../../src/app/map-runtime.ts';
import { splatReadings, splatsSettled } from '../splat-readings.ts';
import type { EngineHandle, EngineOptions } from './bench.ts';

const MB = 1024 * 1024;

// 地址上的 cullWindow：off 是动着也请求，auto 按实测的加载时间，其余是秒数
const cullWindowOf = (value: string): CullWindow | null => {
  if (value === 'off') {
    return null;
  }
  return value === 'auto' ? 'auto' : Number(value);
};

// 各瓦片集里最长的窗口；都不拦时为 null
const longestWindow = (windows: readonly (number | null)[]): number | null => {
  const values = windows.filter(value => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
};

/** MapLibre 引擎：真实的 MapLibreView 和 ThreeSceneRenderer，和产品一样在第一次切到三维时动态导入 */
export async function startMapLibre({ session, container, params, splatCount, onError }: EngineOptions): Promise<EngineHandle> {
  setupMapRuntime();
  const uploadMB = params.get('uploadMB');
  const cullWindow = params.get('cullWindow');
  const splatBudget = params.get('splatBudget');
  let renderer: Renderer | null = null;
  let surface: SceneSurface | null = null;
  const view = new MapLibreView({
    session,
    container,
    onError,
    // 缩放上限放宽（产品的 18 级是页面定的，测量要到 z19）；其余和产品一样，多重采样默认不开
    mapOptions: {
      maxZoom: 24,
      ...(params.get('antialias') === '1' ? { canvasContextAttributes: { antialias: true } } : {})
    },
    loadSceneRenderer: async () => {
      const { ThreeSceneRenderer } = await import('@mx/map-three');
      // 拿到 surface 才能请求重画：静止时每帧都画要用
      class BenchRenderer extends ThreeSceneRenderer {
        override attach(next: SceneSurface): void {
          surface = next;
          super.attach(next);
        }
      }
      const rendererOptions = {
        ...(uploadMB === null ? {} : { uploadBytesPerFrame: uploadMB === 'off' ? null : Number(uploadMB) * MB }),
        ...(cullWindow === null ? {} : { requestCullWindow: cullWindowOf(cullWindow) }),
        ...(splatBudget === null ? {} : { splatBudget: Number(splatBudget) })
      };
      return () => {
        renderer = new BenchRenderer(rendererOptions);
        return renderer;
      };
    }
  });
  await view.whenReady();
  view.setKind('3d');
  await view.whenReady();
  const inspect = () => {
    if (!renderer) {
      throw new Error('三维渲染器还没有创建');
    }
    return renderer.inspect();
  };
  return {
    view,
    config: {
      uploadMB: uploadMB ?? '产品的默认值',
      cullWindow: cullWindow ?? '产品的默认值',
      splatBudget: splatBudget ?? '产品的默认值',
      antialias: params.get('antialias') === '1'
    },
    stats() {
      const state = inspect();
      const tilesets = Object.values(state.tilesets);
      const sum = (read: (item: (typeof tilesets)[number]) => number) => tilesets.reduce((total, item) => total + read(item), 0);
      return {
        tilesVisible: sum(item => item.visible),
        triangles: state.triangles,
        cacheMB: state.cachedBytes / MB,
        errorTarget: Math.max(0, ...tilesets.map(item => item.errorTarget)),
        refused: state.refused,
        loaded: sum(item => item.loaded),
        unloaded: sum(item => item.unloaded),
        failed: sum(item => item.failed),
        loading: state.loading,
        uploadPending: state.uploadPending,
        uploadedMB: state.uploadedBytes / MB,
        locked: state.locked,
        queues: {
          downloading: sum(item => item.downloading),
          parsing: sum(item => item.parsing),
          culled: sum(item => item.culled),
          used: sum(item => item.used),
          usedOutOfView: sum(item => item.usedOutOfView)
        },
        budget: {
          demandMB: state.demandBytes / MB,
          pendingMB: state.pendingBytes / MB,
          culledMB: state.culledBytes / MB,
          raisedFull: state.raisedFull,
          raisedPredicted: state.raisedPredicted,
          cullWindow: longestWindow(tilesets.map(item => item.cullWindow))
        },
        splats: splatReadings(state.splatBudget, Object.values(state.splats))
      };
    },
    // 瓦片集：瓦片到了、不再调整（settled 不看泼溅）；泼溅：每份都读到了索引，当前视角要的细节都到了、没有在加载的分块
    isStable() {
      const state = inspect();
      const tilesets = Object.values(state.tilesets);
      const splats = Object.values(state.splats);
      const tilesReady = state.settled && (tilesets.length === 0 || tilesets.some(item => item.loaded > 0));
      return tilesets.length + splats.length > 0 && tilesReady && splatsSettled(splats, splatCount);
    },
    frames: () => renderer?.inspect().frames ?? 0,
    requestFrame: () => surface?.requestRepaint()
  };
}
