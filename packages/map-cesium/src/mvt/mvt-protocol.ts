import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { TileCoord } from './tile-math';

// 方案 B 的 PoC：矢量瓦片栅格化 Worker 的协议（ADR 0025 的通信层）

/** 画进位图的图层：和二维同一份图层定义 */
export type VectorLayerSpecification = FillLayerSpecification | LineLayerSpecification | CircleLayerSpecification;

/** 样式图片（花纹）：同会话的 StyleImage */
export interface PatternImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly pixelRatio?: number;
  readonly sdf?: boolean;
}

/** 一个矢量数据源在 Worker 里的配置：图层从下到上 */
export interface VectorSourceConfig {
  /** 瓦片地址模板，带 {z}、{x}、{y} */
  readonly tiles: string;
  readonly minzoom: number;
  readonly maxzoom: number;
  /** 位图的边长（像素），也是对 Cesium 声明的瓦片尺寸 */
  readonly tileSize: number;
  readonly layers: readonly VectorLayerSpecification[];
  readonly labelLayers: readonly SymbolLayerSpecification[];
  readonly images: Readonly<Record<string, PatternImage>>;
  /** 识别要留下的属性（业务主键）；解码时其余没人用的属性不留 */
  readonly identifyKeys: readonly string[];
  /** 这个 Worker 给全部数据源的几何缓存预算（字节） */
  readonly cacheBytes: number;
}

export interface TileTiming {
  /** 这次请求下载了瓦片（没命中 Worker 的几何缓存） */
  readonly fetched: boolean;
  readonly fetchMs: number;
  readonly decodeMs: number;
  readonly drawMs: number;
  /** 解压后的字节数；经网络传输的字节数取不到时为 null，0 是浏览器缓存 */
  readonly bytes: number;
  readonly transferBytes: number | null;
}

export interface RenderReply {
  /** 全透明时为 null，主线程自己用空白画布 */
  readonly bitmap: ImageBitmap | null;
  /** 实际下载的那张瓦片；这一级没有图层要画时为 null */
  readonly source: TileCoord | null;
  readonly features: number;
  readonly timing: TileTiming;
}

export interface LabelCandidate {
  readonly lng: number;
  readonly lat: number;
  readonly text: string;
  readonly area: number;
  readonly tile: TileCoord;
}

/** 文字的样式：按图层求一次值，不按要素 */
export interface LabelPaint {
  readonly size: number;
  readonly color: string;
  readonly haloColor: string;
  readonly haloWidth: number;
}

export interface LabelReply {
  readonly candidates: readonly LabelCandidate[];
  /** 点名了但几何缓存里已经没有的瓦片 */
  readonly missing: readonly string[];
  readonly paint: LabelPaint;
}

export interface IdentifiedFeature {
  readonly sourceLayer: string;
  readonly geometry: 'Point' | 'LineString' | 'Polygon';
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

/** 一个 Worker 的累计读数（测量用） */
export interface WorkerStats {
  readonly rendered: number;
  readonly fetched: number;
  readonly fetchMs: number;
  readonly decodeMs: number;
  readonly drawMs: number;
  readonly bitmapMs: number;
  readonly bytes: number;
  /** 取得到传输字节数的瓦片里，来自浏览器缓存的张数和经网络的字节数 */
  readonly fromHttpCache: number;
  readonly transferBytes: number;
  readonly cacheTiles: number;
  readonly cacheBytes: number;
  /** 画过的各级位图张数 */
  readonly levels: Readonly<Record<number, number>>;
}

export interface MvtWorkerProtocol {
  /** 新建或更新一个数据源：地址没变时留着几何缓存，只换样式 */
  readonly configure: { readonly request: { readonly id: string; readonly config: VectorSourceConfig }; readonly response: void };
  readonly render: {
    readonly request: { readonly id: string; readonly tile: TileCoord; readonly headers: Readonly<Record<string, string>> | null };
    readonly response: RenderReply;
  };
  readonly labels: {
    readonly request: { readonly id: string; readonly layerId: string; readonly tiles: readonly TileCoord[]; readonly limit: number };
    readonly response: LabelReply;
  };
  readonly identify: {
    readonly request: {
      readonly id: string;
      readonly lng: number;
      readonly lat: number;
      /** 相机的缩放级（二维口径），容差按它换算 */
      readonly zoom: number;
      /** 屏幕像素 */
      readonly tolerance: number;
      readonly headers: Readonly<Record<string, string>> | null;
    };
    readonly response: readonly IdentifiedFeature[];
  };
  readonly stats: { readonly request: null; readonly response: WorkerStats };
  readonly remove: { readonly request: { readonly id: string }; readonly response: void };
}
