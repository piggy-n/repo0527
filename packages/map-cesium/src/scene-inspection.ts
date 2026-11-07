// 场景的诊断读数（只读快照）：给开发页记录瓦片集的显存、屏幕误差和加载情况，业务代码不用

/** Cesium 瓦片集统计里和加载有关的计数（Cesium3DTilesetStatistics，类型声明里没有） */
export interface TilesetStatistics {
  /** 这一帧选中（要画）的瓦片数 */
  readonly selected: number;
  /** 这一帧遍历到的瓦片数 */
  readonly visited: number;
  /** 这一帧因为请求数满而没有发出的请求 */
  readonly numberOfAttemptedRequests: number;
  readonly numberOfPendingRequests: number;
  readonly numberOfTilesProcessing: number;
  /** 内容已就绪、留在缓存里的瓦片数 */
  readonly numberOfTilesWithContentReady: number;
  readonly numberOfTilesTotal: number;
  /** 累计加载过的瓦片数（卸载后重新加载也计） */
  readonly numberOfLoadedTilesTotal: number;
}

/** 一个瓦片集的读数 */
export interface TilesetInspection {
  readonly id: string;
  readonly show: boolean;
  readonly cacheBytes: number;
  readonly maximumCacheOverflowBytes: number;
  /** 交给 Cesium 的屏幕误差：定了地板时就是地板，否则是设定值 */
  readonly maximumScreenSpaceError: number;
  /** 这个相机姿态下定的地板（map-cesium.md"瓦片集的显存预算"），没定时为 null */
  readonly screenSpaceErrorFloor: number | null;
  /** 按显存调整后实际用的屏幕误差 */
  readonly memoryAdjustedScreenSpaceError: number;
  /** Cesium 估算的显存占用（几何、贴图、批次表） */
  readonly totalMemoryUsageInBytes: number;
  /** 没有待请求、处理中的瓦片 */
  readonly tilesLoaded: boolean;
  readonly statistics: TilesetStatistics;
  /** 加进场景以来的累计：瓦片加载完成、被卸载、加载失败的次数 */
  readonly loaded: number;
  readonly unloaded: number;
  readonly failed: number;
}

/** 整个场景的读数 */
export interface SceneInspection {
  /** 累计：渲染循环跑过的 tick 数（渲染与否都计）、真正画出的帧数 */
  readonly ticks: number;
  readonly frames: number;
  /** 累计：渲染出错的次数（WebGL 上下文丢失时每个 tick 一次） */
  readonly renderErrors: number;
  /** 累计：相机变化、相机停下的次数 */
  readonly cameraChanges: number;
  readonly cameraIdles: number;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  readonly devicePixelRatio: number;
  /** 浏览器报告的显卡（WEBGL_debug_renderer_info），取不到时为空字符串 */
  readonly renderer: string;
  readonly tilesets: readonly TilesetInspection[];
}
