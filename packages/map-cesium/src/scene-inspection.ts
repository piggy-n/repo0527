// 场景的读数（只读快照）：给性能测量记录瓦片集的显存、屏幕误差和加载情况，业务代码不用

/** Cesium 瓦片集统计里和加载、绘制有关的计数（Cesium3DTilesetStatistics，类型声明里没有） */
export interface TilesetStatistics {
  /** 这一帧选中（要画）的瓦片数 */
  readonly selected: number;
  readonly numberOfPendingRequests: number;
  readonly numberOfTilesProcessing: number;
  /** 这一帧选中的瓦片的三角形数 */
  readonly numberOfTrianglesSelected: number;
}

/** 一个瓦片集的读数 */
export interface TilesetInspection {
  readonly id: string;
  readonly show: boolean;
  readonly cacheBytes: number;
  readonly maximumCacheOverflowBytes: number;
  readonly maximumScreenSpaceError: number;
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
  /** 累计：真正画出的帧数 */
  readonly frames: number;
  /** 影像瓦片都到了（同地球的 tilesLoaded） */
  readonly imageryLoaded: boolean;
  readonly tilesets: readonly TilesetInspection[];
}
