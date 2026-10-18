import type { LayerSpecification, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleImages, TileCoordinate, TileDataRequest, TileDataStats } from '@yzt/map-core/worker';

/** 绘制快照可结构化克隆，不传编译函数或缓存中的几何 */
export interface MvtRenderRequest {
  readonly data: TileDataRequest;
  readonly source: VectorSourceSpecification;
  readonly layer: LayerSpecification;
  readonly images?: StyleImages;
  readonly cameraZoom: number;
  readonly tile: TileCoordinate;
  readonly tileSize?: number;
  /** 每个 Worker 的预算，崩溃重建后的首个请求重新建立相同约束 */
  readonly budgetBytes: number;
}

export interface MvtWorkerProtocol {
  readonly render: { readonly request: MvtRenderRequest; readonly response: ImageBitmap };
  readonly stats: { readonly request: undefined; readonly response: TileDataStats | null };
}
