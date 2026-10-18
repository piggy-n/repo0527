import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { yieldToEventLoop } from '@yzt/utils';

export type TileProperty = string | number | boolean;

/** 原生瓦片坐标的连续路径，只在 Worker 内使用，不转移缓存 */
export interface DecodedTileFeature {
  readonly id?: number;
  readonly type: 1 | 2 | 3;
  readonly properties: Readonly<Record<string, TileProperty>>;
  readonly geometry: readonly Int32Array[];
  /** 每个面按外环、内洞排列，路径与 geometry 共用内存 */
  readonly polygons?: readonly (readonly Int32Array[])[];
}

export interface DecodedTileLayer {
  readonly extent: number;
  readonly features: readonly DecodedTileFeature[];
}

export interface DecodedTile {
  readonly layers: Readonly<Record<string, DecodedTileLayer>>;
  /** TypedArray 精确字节与对象、属性字符串的保守估算之和 */
  readonly bytes: number;
}

export interface DecodeTileOptions {
  readonly signal: AbortSignal;
  readonly checkpoint?: () => Promise<void>;
}

// 批量上限约束取消消息等待时间，单个第三方 loadGeometry 调用不可从外部打断
const FEATURES_PER_BATCH = 64;

/** 属性键值计入预算；MVT 的合法值没有 null */
function propertyBytes(properties: Readonly<Record<string, TileProperty>>): number {
  let bytes = 32;
  for (const [key, value] of Object.entries(properties)) {
    bytes += 24 + key.length * 2 + (typeof value === 'string' ? value.length * 2 : 8);
  }
  return bytes;
}

/** 使用成熟 MVT 解码器，裁剪属性并在批次之间让出事件循环 */
export async function decodeMvt(
  raw: ArrayBuffer,
  fields: ReadonlySet<string> | null,
  { signal, checkpoint = yieldToEventLoop }: DecodeTileOptions
): Promise<DecodedTile> {
  signal.throwIfAborted();
  const layers: Record<string, DecodedTileLayer> = Object.create(null) as Record<string, DecodedTileLayer>;
  let bytes = 64;
  if (raw.byteLength === 0) {
    return { layers, bytes };
  }
  const tile = new VectorTile(new PbfReader(raw));
  let count = 0;
  for (const [name, layer] of Object.entries(tile.layers)) {
    if (!Number.isSafeInteger(layer.extent) || layer.extent <= 0) {
      throw new RangeError('MVT extent 必须是正安全整数');
    }
    const features: DecodedTileFeature[] = [];
    bytes += 96 + name.length * 2;
    for (let index = 0; index < layer.length; index++) {
      if (count++ % FEATURES_PER_BATCH === 0) {
        // oxlint-disable-next-line no-await-in-loop -- 解码按批次主动让出事件循环，供 Worker 处理取消消息
        await checkpoint();
        signal.throwIfAborted();
      }
      const feature = layer.feature(index);
      if (feature.type !== 1 && feature.type !== 2 && feature.type !== 3) {
        throw new TypeError('MVT 包含不支持的几何类型');
      }
      if (feature.id !== undefined && (!Number.isSafeInteger(feature.id) || feature.id < 0)) {
        throw new RangeError('MVT 要素 ID 超出安全整数范围');
      }
      const properties: Record<string, TileProperty> = Object.create(null) as Record<string, TileProperty>;
      for (const [key, value] of Object.entries(feature.properties)) {
        if (fields === null || fields.has(key)) {
          properties[key] = value;
        }
      }
      const paths = feature.loadGeometry();
      const geometry = paths.map(path => {
        const coordinates = new Int32Array(path.length * 2);
        for (let point = 0; point < path.length; point++) {
          const { x, y } = path[point];
          if (!Number.isInteger(x) || x < -2147483648 || x > 2147483647 ||
            !Number.isInteger(y) || y < -2147483648 || y > 2147483647) {
            throw new RangeError('MVT 坐标超出 Int32 范围');
          }
          coordinates[point * 2] = x;
          coordinates[point * 2 + 1] = y;
        }
        bytes += 32 + coordinates.byteLength;
        return coordinates;
      });
      const pathLookup = new Map(paths.map((path, pathIndex) => [path, geometry[pathIndex]]));
      const polygons = feature.type === 3
        ? classifyRings(paths).map(polygon => polygon.map(path => {
          const ring = pathLookup.get(path);
          if (!ring) {
            throw new Error('MVT 面分类返回了未知路径');
          }
          return ring;
        }))
        : undefined;
      bytes += 128 + propertyBytes(properties) + (polygons?.reduce((sum, polygon) => sum + 32 + polygon.length * 8, 0) ?? 0);
      features.push({ id: feature.id, type: feature.type, properties, geometry, polygons });
    }
    layers[name] = { extent: layer.extent, features };
  }
  signal.throwIfAborted();
  return { layers, bytes };
}
