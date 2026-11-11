import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

// 方案 B 的 PoC：矢量瓦片的解码和几何工具，不依赖 DOM、Cesium（移植自旧项目的 tileRenderer.js）。
// 顶点存扁平的 TypedArray [x0,y0,x1,y1,...]：比 {x,y} 对象省 8 倍内存，也没有 GC 扫描的成本

export type Ring = Int16Array | Int32Array;

export interface TilePolygon {
  readonly exterior: Ring;
  readonly holes: Ring[];
  /** 标注的锚点（瓦片坐标），第一次用到时算 */
  anchor?: readonly [number, number];
}

export type FeatureProperties = Record<string, string | number | boolean>;

export interface TileFeature {
  readonly sourceLayer: string;
  /** MVT 的几何类型：1 点、2 线、3 面；style-spec 求值时按它得出 geometry-type */
  readonly type: 1 | 2 | 3;
  readonly properties: FeatureProperties;
  readonly id: number | undefined;
  readonly extent: number;
  readonly rings: readonly Ring[];
  /** 瓦片坐标下的包围盒：minX、minY、maxX、maxY */
  readonly box: readonly [number, number, number, number];
  /** 面按外环和洞分好的结果，标注和识别第一次用到时算 */
  polygons?: TilePolygon[];
}

export interface DecodedTile {
  readonly features: TileFeature[];
  /** 估算的内存占用，缓存按它淘汰 */
  readonly bytes: number;
}

const INT16_LIMIT = 32767;
// 每个要素的固定开销：属性对象、环数组本身
const BYTES_PER_FEATURE = 160;

interface PointLike {
  readonly x: number;
  readonly y: number;
}

function flatRing(points: readonly PointLike[], box: [number, number, number, number]): Ring {
  let wide = false;
  for (const { x, y } of points) {
    if (x > INT16_LIMIT || x < -INT16_LIMIT || y > INT16_LIMIT || y < -INT16_LIMIT) {
      wide = true;
    }
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  }
  const ring = wide ? new Int32Array(points.length * 2) : new Int16Array(points.length * 2);
  for (const [index, point] of points.entries()) {
    ring[index * 2] = point.x;
    ring[index * 2 + 1] = point.y;
  }
  return ring;
}

// 只留真正会读到的属性：每个要素都不同的标识码字符串才是内存的大头（旧项目实测一张瓦片 10 MB 降到 1.7 MB）
function keepProperties(properties: FeatureProperties, keep: ReadonlySet<string> | null): FeatureProperties {
  if (!keep) {
    return properties;
  }
  const kept: FeatureProperties = {};
  for (const key of keep) {
    const value = properties[key];
    if (value !== undefined) {
      kept[key] = value;
    }
  }
  return kept;
}

/** 解码一张瓦片；keep 为 null 时属性全留 */
export function decodeTile(buffer: ArrayBuffer, keep: ReadonlySet<string> | null): DecodedTile {
  const features: TileFeature[] = [];
  let bytes = 0;
  if (buffer.byteLength === 0) {
    return { features, bytes };
  }
  const tile = new VectorTile(new PbfReader(buffer));
  for (const [sourceLayer, layer] of Object.entries(tile.layers)) {
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      const { type } = feature;
      if (type !== 1 && type !== 2 && type !== 3) {
        continue;
      }
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      const rings = feature.loadGeometry().map(points => flatRing(points, box));
      bytes += BYTES_PER_FEATURE + rings.reduce((total, ring) => total + ring.byteLength, 0);
      features.push({
        sourceLayer,
        type,
        properties: keepProperties(feature.properties, keep),
        id: feature.id,
        extent: layer.extent,
        rings,
        box
      });
    }
  }
  return { features, bytes };
}

const ringSize = (ring: Ring) => ring.length >> 1;

export function signedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, n = ringSize(ring), j = n - 1; i < n; j = i++) {
    area += (ring[j * 2] ?? 0) * (ring[i * 2 + 1] ?? 0) - (ring[i * 2] ?? 0) * (ring[j * 2 + 1] ?? 0);
  }
  return area / 2;
}

/** 面的环按外环和洞分组：MVT 规定外环面积为正（屏幕坐标下顺时针），洞为负 */
export function polygonsOf(feature: TileFeature): TilePolygon[] {
  if (feature.polygons) {
    return feature.polygons;
  }
  const polygons: TilePolygon[] = [];
  let current: TilePolygon | null = null;
  for (const ring of feature.rings) {
    if (signedArea(ring) > 0) {
      current = { exterior: ring, holes: [] };
      polygons.push(current);
    } else {
      current?.holes.push(ring);
    }
  }
  const [first] = feature.rings;
  if (polygons.length === 0 && first) {
    polygons.push({ exterior: first, holes: [] });
  }
  feature.polygons = polygons;
  return polygons;
}

function ringContains(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, n = ringSize(ring), j = n - 1; i < n; j = i++) {
    const ax = ring[i * 2] ?? 0;
    const ay = ring[i * 2 + 1] ?? 0;
    const bx = ring[j * 2] ?? 0;
    const by = ring[j * 2 + 1] ?? 0;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
      inside = !inside;
    }
  }
  return inside;
}

/** 点在面里：在外环里、不在洞里 */
export function polygonContains({ exterior, holes }: TilePolygon, x: number, y: number): boolean {
  return ringContains(exterior, x, y) && !holes.some(hole => ringContains(hole, x, y));
}

function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  let x = ax;
  let y = ay;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = bx;
      y = by;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  return (px - x) ** 2 + (py - y) ** 2;
}

/** 点到折线的距离的平方；closed 时把首尾连起来 */
export function ringDistanceSq(ring: Ring, x: number, y: number, closed: boolean): number {
  const n = ringSize(ring);
  let nearest = Infinity;
  for (let i = closed ? 0 : 1, j = closed ? n - 1 : 0; i < n; j = i++) {
    nearest = Math.min(
      nearest,
      segmentDistanceSq(x, y, ring[j * 2] ?? 0, ring[j * 2 + 1] ?? 0, ring[i * 2] ?? 0, ring[i * 2 + 1] ?? 0)
    );
  }
  if (n === 1) {
    nearest = (x - (ring[0] ?? 0)) ** 2 + (y - (ring[1] ?? 0)) ** 2;
  }
  return nearest;
}

function ringCentroid(ring: Ring): { x: number; y: number } {
  const n = ringSize(ring);
  let x = 0;
  let y = 0;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const jx = ring[j * 2] ?? 0;
    const jy = ring[j * 2 + 1] ?? 0;
    const ix = ring[i * 2] ?? 0;
    const iy = ring[i * 2 + 1] ?? 0;
    const cross = jx * iy - ix * jy;
    area += cross;
    x += (jx + ix) * cross;
    y += (jy + iy) * cross;
  }
  if (area === 0) {
    return { x: ring[0] ?? 0, y: ring[1] ?? 0 };
  }
  return { x: x / (3 * area), y: y / (3 * area) };
}

// 标注锚点的收敛精度：MapLibre 是 findPoleOfInaccessibility(polygon, 16)，它的几何已经换算到 8192 的范围，
// 所以这里按瓦片的 extent 折算；旧项目实测用相对精度时只有 37% 的锚点和二维一致
const ANCHOR_PRECISION_AT_8192 = 16;
// 防病态几何把 Worker 卡死的上限，不是画质的旋钮（旧项目实测每个面平均探测 86 次）
const ANCHOR_PROBE_LIMIT = 20000;

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly half: number;
  readonly distance: number;
  readonly max: number;
}

// 点到面的带符号距离：里面为正
function signedDistance(polygon: TilePolygon, x: number, y: number): number {
  let nearest = ringDistanceSq(polygon.exterior, x, y, true);
  for (const hole of polygon.holes) {
    nearest = Math.min(nearest, ringDistanceSq(hole, x, y, true));
  }
  return (polygonContains(polygon, x, y) ? 1 : -1) * Math.sqrt(nearest);
}

function cellAt(polygon: TilePolygon, x: number, y: number, half: number): Cell {
  const distance = signedDistance(polygon, x, y);
  return { x, y, half, distance, max: distance + half * Math.SQRT2 };
}

/** 面内离边界最远的点（polylabel），和 MapLibre 的面标注同一个算法；结果记在面上 */
export function anchorOf(polygon: TilePolygon, extent: number): readonly [number, number] {
  if (polygon.anchor) {
    return polygon.anchor;
  }
  const { exterior } = polygon;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < exterior.length; i += 2) {
    minX = Math.min(minX, exterior[i] ?? 0);
    minY = Math.min(minY, exterior[i + 1] ?? 0);
    maxX = Math.max(maxX, exterior[i] ?? 0);
    maxY = Math.max(maxY, exterior[i + 1] ?? 0);
  }
  const size = Math.min(maxX - minX, maxY - minY);
  if (!(size > 0)) {
    polygon.anchor = [minX, minY];
    return polygon.anchor;
  }
  // 按 max 从大到小取：瓦片里的面顶点不多，排序的数组够用
  const queue: Cell[] = [];
  const push = (cell: Cell) => {
    let low = 0;
    let high = queue.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((queue[middle]?.max ?? 0) < cell.max) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    queue.splice(low, 0, cell);
  };
  for (let x = minX; x < maxX; x += size) {
    for (let y = minY; y < maxY; y += size) {
      push(cellAt(polygon, x + size / 2, y + size / 2, size / 2));
    }
  }
  const precision = (ANCHOR_PRECISION_AT_8192 * extent) / 8192;
  const centroid = ringCentroid(exterior);
  let best = cellAt(polygon, centroid.x, centroid.y, 0);
  for (let probes = 0; probes < ANCHOR_PROBE_LIMIT; probes++) {
    const cell = queue.pop();
    if (!cell) {
      break;
    }
    // 质心落在边界上（距离为 0）时也要被后面的格子换掉，同 MapLibre
    if (cell.distance > best.distance || !best.distance) {
      best = cell;
    }
    if (cell.max - best.distance <= precision) {
      continue;
    }
    const half = cell.half / 2;
    push(cellAt(polygon, cell.x - half, cell.y - half, half));
    push(cellAt(polygon, cell.x + half, cell.y - half, half));
    push(cellAt(polygon, cell.x - half, cell.y + half, half));
    push(cellAt(polygon, cell.x + half, cell.y + half, half));
  }
  polygon.anchor = [best.x, best.y];
  return polygon.anchor;
}
