import type { Feature, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { nativeTileCoordinate, type DecodedTile, type DecodedTileFeature, type TileCoordinate } from '@yzt/map-core/worker';
import type { TaskContext } from '@yzt/utils';
import {
  drawCanvasCooperatively, prepareCanvasDrawing, type CanvasContext, type CanvasProject, type CanvasShape
} from './canvas-renderer';
import type { BasicStyleLayer } from './style-plan';

/** 可注入的画布边界用于验证取消和资源所有权 */
export interface MvtCanvas {
  getContext(kind: '2d'): CanvasContext | null;
  transferToImageBitmap(): ImageBitmap;
}

export interface MvtRenderOptions {
  readonly data: DecodedTile;
  readonly layer: BasicStyleLayer;
  readonly source: VectorSourceSpecification;
  readonly coordinate: TileCoordinate;
  readonly tile: TileCoordinate;
  readonly cameraZoom: number;
  readonly tileSize?: number;
  readonly context: TaskContext;
  readonly createCanvas?: (size: number) => MvtCanvas;
}

// 过滤掉的要素也计入批次，防止整张瓦片均被过滤时长时间占用 Worker
const FEATURES_PER_CHECKPOINT = 64;

/** 把父瓦片矢量重新绘成当前显示瓦片，不放大父瓦片的旧图片 */
export async function renderMvt({
  data, layer, source, coordinate, tile, cameraZoom, tileSize = 512, context,
  createCanvas = size => new OffscreenCanvas(size, size)
}: MvtRenderOptions): Promise<ImageBitmap> {
  const { signal, checkpoint } = context;
  signal.throwIfAborted();
  if (!Number.isFinite(cameraZoom) || !Number.isInteger(tileSize) || tileSize < 1 || tileSize > 4096) {
    throw new RangeError('MVT 绘制需要有限相机级别与 1～4096 的整数画布尺寸');
  }
  const parent = nativeTileCoordinate(tile, coordinate.z);
  if (parent.x !== coordinate.x || parent.y !== coordinate.y || parent.z !== coordinate.z) {
    throw new Error('MVT 数据瓦片必须是显示瓦片或其祖先');
  }
  const specification = layer.specification;
  const sourceLayer = 'source-layer' in specification ? specification['source-layer'] : undefined;
  if (!sourceLayer) {
    throw new Error('MVT 绘制需要 source-layer');
  }
  const canvas = createCanvas(tileSize);
  const drawing = canvas.getContext('2d');
  if (!drawing) { throw new Error('无法创建 MVT 的 OffscreenCanvas 二维上下文'); }
  const decoded = data.layers[sourceLayer];
  if (decoded && layer.visible(cameraZoom)) {
    const ratio = 2 ** (tile.z - coordinate.z);
    const offsetX = tile.x - coordinate.x * ratio;
    const offsetY = tile.y - coordinate.y * ratio;
    const project: CanvasProject = (x, y) => [
      (x / decoded.extent * ratio - offsetX) * tileSize,
      (y / decoded.extent * ratio - offsetY) * tileSize
    ];
    const scale = 2 ** (tile.z - cameraZoom) * tileSize / 512;
    let count = 0;
    for (const feature of decoded.features) {
      if (count++ % FEATURES_PER_CHECKPOINT === 0) {
        // oxlint-disable-next-line no-await-in-loop -- 绘制按批次让出事件循环以处理 Worker 取消消息
        await checkpoint();
        signal.throwIfAborted();
      }
      const styleFeature = featureForStyle(feature, source, sourceLayer);
      if (!layer.accepts(cameraZoom, styleFeature)) { continue; }
      const type = geometryType(feature.type);
      // 每个外环及其洞单独填充，多个面之间不互相挖洞
      const parts = layer.type === 'fill' && type === 'Polygon'
        ? feature.polygons ?? [feature.geometry]
        : [feature.geometry];
      for (const paths of parts) {
        const shape: CanvasShape = { type, paths, feature: styleFeature };
        const draw = prepareCanvasDrawing(layer, shape, cameraZoom);
        if (draw) {
          // oxlint-disable-next-line no-await-in-loop -- 同一要素的面按原始顺序绘制，长路径内部继续分批检查取消
          await drawCanvasCooperatively(drawing, draw, project, scale, checkpoint);
          signal.throwIfAborted();
        }
        if (count++ % FEATURES_PER_CHECKPOINT === 0) {
          // oxlint-disable-next-line no-await-in-loop -- 一个多面要素也可能包含大量短环，不能只按要素数让出
          await checkpoint();
          signal.throwIfAborted();
        }
      }
    }
  }
  signal.throwIfAborted();
  const bitmap = canvas.transferToImageBitmap();
  try {
    // 给取消消息最后一次机会；一旦成功返回，所有权由通信层转给主线程
    await checkpoint();
    signal.throwIfAborted();
    return bitmap;
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

function geometryType(type: DecodedTileFeature['type']): CanvasShape['type'] {
  return type === 1 ? 'Point' : type === 2 ? 'LineString' : 'Polygon';
}

// promoteId 与 MapLibre 一致：缺少指定属性时不回退原始 ID，布尔属性转换为数字
function featureForStyle(
  feature: DecodedTileFeature,
  source: VectorSourceSpecification,
  sourceLayer: string
): Feature {
  let id: string | number | undefined = feature.id;
  if (source.promoteId !== undefined) {
    const field = typeof source.promoteId === 'string' ? source.promoteId : source.promoteId[sourceLayer];
    const value = field === undefined ? undefined : feature.properties[field];
    id = typeof value === 'boolean' ? Number(value) : value;
  }
  return { type: geometryType(feature.type), properties: feature.properties, id };
}
