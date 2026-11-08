import { type CesiumScene, CesiumView, createCesiumScene } from '@mx/map-cesium';
import { setupSceneRuntime } from '../../../src/app/map-runtime-3d.ts';
import type { EngineHandle, EngineOptions } from './bench.ts';

const MB = 1024 * 1024;

/** Cesium 引擎：真实的 CesiumView 和 CesiumScene */
export async function startCesium({ session, container, onError }: EngineOptions): Promise<EngineHandle> {
  setupSceneRuntime();
  let scene: CesiumScene | null = null;
  const view = new CesiumView({
    session,
    container,
    onError,
    createScene: target => {
      scene = createCesiumScene(target);
      return scene;
    }
  });
  await view.whenReady();
  const inspect = () => {
    if (!scene) {
      throw new Error('Cesium 场景还没有创建');
    }
    return scene.inspect();
  };
  const first = () => inspect().tilesets[0];
  return {
    view,
    config: {
      cacheMB: (first()?.cacheBytes ?? 0) / MB,
      overflowMB: (first()?.maximumCacheOverflowBytes ?? 0) / MB
    },
    stats() {
      const { tilesets } = inspect();
      const sum = (read: (item: (typeof tilesets)[number]) => number) => tilesets.reduce((total, item) => total + read(item), 0);
      return {
        tilesVisible: sum(item => item.statistics.selected),
        triangles: sum(item => item.statistics.numberOfTrianglesSelected),
        cacheMB: sum(item => item.totalMemoryUsageInBytes) / MB,
        errorTarget: Math.max(0, ...tilesets.map(item => item.memoryAdjustedScreenSpaceError)),
        refused: null,
        loaded: sum(item => item.loaded),
        unloaded: sum(item => item.unloaded),
        failed: sum(item => item.failed),
        loading: sum(item => item.statistics.numberOfPendingRequests + item.statistics.numberOfTilesProcessing),
        uploadPending: null,
        uploadedMB: null,
        locked: null
      };
    },
    isStable() {
      const { tilesets } = inspect();
      return (
        tilesets.length > 0 &&
        tilesets.every(
          item =>
            item.tilesLoaded && item.statistics.numberOfPendingRequests === 0 && item.statistics.numberOfTilesProcessing === 0
        )
      );
    },
    frames: () => scene?.inspect().frames ?? 0,
    requestFrame: () => scene?.requestFrame()
  };
}
