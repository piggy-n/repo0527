import {
  Cartesian3, Cartographic, Credit, Event, GeographicTilingScheme, Math as CesiumMath, Rectangle, WebMercatorProjection,
  type ImageryProvider, type TileProviderError
} from 'cesium';
import type { Feature as StyleFeature } from '@maplibre/maplibre-gl-style-spec';
import type { GeoJSON, Geometry, Position } from 'geojson';
import { canvasColor, canvasNumber } from './canvas-renderer';
import type { BasicStyleLayer } from './style-plan';

interface MaskPolygon {
  readonly world: boolean;
  readonly rings: readonly (readonly Position[])[];
  readonly feature: StyleFeature;
}

// 二维世界外环使用六位小数；识别容差仅用于这张矩形，不放宽普通业务坐标
const WORLD_LATITUDE = 85.051129;
const WORLD_TOLERANCE = 0.000001;
const TILE_SIZE = 512;
const PIXEL_ERROR = 0.25;
const MAX_SUBDIVISION = 24;

/** 只识别世界矩形外环，不依赖业务分组或图层名称 */
export function hasWorldMask(data: GeoJSON): boolean {
  return polygons(data).some(polygon => worldRing(polygon.rings[0] ?? []));
}

/** 将世界补集逐瓦片铺满球面，洞与岛仍沿二维墨卡托直边绘制 */
export function createWorldMaskProvider(layer: BasicStyleLayer, zoom: number): ImageryProvider {
  if (layer.type !== 'fill' || layer.source?.type !== 'geojson' || typeof layer.source.data === 'string') {
    throw new Error('全球遮罩仅支持内联 GeoJSON 填充图层');
  }
  const projection = new WebMercatorProjection();
  const prepared = polygons(layer.source.data).map(polygon => ({
    world: polygon.world,
    feature: polygon.feature,
    rings: polygon.rings.slice(polygon.world ? 1 : 0).map(ring => projectedRing(ring, projection))
  }));
  const tilingScheme = new GeographicTilingScheme();
  const credit = layer.source.attribution ? new Credit(layer.source.attribution) : undefined;
  const provider = {
    rectangle: tilingScheme.rectangle,
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    minimumLevel: 0,
    maximumLevel: 22,
    tilingScheme,
    tileDiscardPolicy: undefined,
    errorEvent: new Event<(error: TileProviderError) => void>(),
    credit,
    proxy: undefined,
    hasAlphaChannel: true,
    getTileCredits: () => undefined,
    pickFeatures: () => undefined,
    requestImage: async (x, y, level) => {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const context = canvas.getContext('2d');
      if (!context) { throw new Error('无法创建全球遮罩的二维画布'); }
      if (!layer.visible(zoom)) { return canvas; }
      const bounds = tilingScheme.tileXYToRectangle(x, y, level);
      const coverage = document.createElement('canvas');
      coverage.width = TILE_SIZE;
      coverage.height = TILE_SIZE;
      const mask = coverage.getContext('2d', { willReadFrequently: true });
      if (!mask) { throw new Error('无法创建全球遮罩的覆盖画布'); }
      for (const polygon of prepared) {
        if (!layer.accepts(zoom, polygon.feature)) { continue; }
        const value = (property: string) => layer.value(property, zoom, polygon.feature);
        if (value('fill-pattern') !== undefined) {
          throw new Error('全球遮罩暂不支持 fill-pattern');
        }
        if (value('fill-antialias') !== false) {
          throw new Error('全球遮罩需要 fill-antialias: false');
        }
        mask.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
        mask.beginPath();
        if (polygon.world) { mask.rect(0, 0, TILE_SIZE, TILE_SIZE); }
        for (const ring of polygon.rings) {
          const path = maskTilePath(ring, bounds, projection);
          if (path.length === 0) { continue; }
          mask.moveTo(path[0][0], path[0][1]);
          for (const [pointX, pointY] of path.slice(1)) { mask.lineTo(pointX, pointY); }
          mask.closePath();
        }
        mask.fillStyle = '#ffffff';
        mask.fill('evenodd');
        // 路径自身的抗锯齿不能用 imageSmoothingEnabled 关闭；先二值覆盖，再应用颜色与透明度
        const pixels = mask.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
        for (let index = 3; index < pixels.data.length; index += 4) {
          pixels.data[index] = pixels.data[index] >= 128 ? 255 : 0;
        }
        mask.putImageData(pixels, 0, 0);
        mask.globalCompositeOperation = 'source-in';
        mask.fillStyle = canvasColor(value('fill-color'));
        mask.globalAlpha = canvasNumber(value('fill-opacity'), 'fill-opacity', 1);
        mask.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
        mask.globalCompositeOperation = 'source-over';
        mask.globalAlpha = 1;
        context.drawImage(coverage, 0, 0);
      }
      return canvas;
    }
  } satisfies Omit<ImageryProvider, 'tileDiscardPolicy' | 'credit' | 'proxy' | 'getTileCredits'> & {
    tileDiscardPolicy: undefined;
    credit: Credit | undefined;
    proxy: undefined;
    getTileCredits(): undefined;
  };
  // SDK 的可选值运行时允许 undefined，发布类型未标注可选
  return provider as unknown as ImageryProvider;
}

// 只把四条轴对齐世界边组成的闭合矩形视为球面补集，不能把普通大面误判为遮罩
function worldRing(ring: readonly Position[]): boolean {
  if (ring.length !== 5 || ring[0][0] !== ring[4][0] || ring[0][1] !== ring[4][1]) { return false; }
  const corners = new Set<string>();
  for (let index = 0; index < 4; index++) {
    const [longitude, latitude] = ring[index];
    const next = ring[index + 1];
    if (Math.abs(longitude) !== 180 || Math.abs(Math.abs(latitude) - WORLD_LATITUDE) > WORLD_TOLERANCE ||
      !Number.isFinite(latitude) || ((longitude === next[0]) === (latitude === next[1]))) { return false; }
    corners.add(`${longitude}:${Math.sign(latitude)}`);
  }
  return corners.size === 4;
}

// 各 Polygon 分开保留，岛上的洞不能被另一部分的偶奇填充抵消
function polygons(data: GeoJSON): MaskPolygon[] {
  const result: MaskPolygon[] = [];
  const append = (geometry: Geometry | null, properties: Record<string, unknown>, id?: string | number): void => {
    if (!geometry) { return; }
    const add = (rings: Position[][]) => result.push({
      world: worldRing(rings[0] ?? []), rings, feature: { type: 'Polygon' as const, properties, id }
    });
    if (geometry.type === 'Polygon') { add(geometry.coordinates); }
    if (geometry.type === 'MultiPolygon') { geometry.coordinates.forEach(add); }
    if (geometry.type === 'GeometryCollection') {
      for (const child of geometry.geometries) { append(child, properties, id); }
    }
  };
  if (data.type === 'FeatureCollection') {
    for (const feature of data.features) { append(feature.geometry, feature.properties ?? {}, feature.id); }
  } else if (data.type === 'Feature') {
    append(data.geometry, data.properties ?? {}, data.id);
  } else {
    append(data, {});
  }
  return result;
}

// 普通洞和岛不跨日界线、不伸到极区；完整世界环已单独转成瓦片覆盖
function projectedRing(ring: readonly Position[], projection: WebMercatorProjection): readonly Position[] {
  if (ring.length < 4) { throw new Error('全球遮罩的环坐标数量不足'); }
  if (ring[0][0] !== ring.at(-1)?.[0] || ring[0][1] !== ring.at(-1)?.[1]) {
    throw new Error('全球遮罩的多边形必须是闭合环');
  }
  return ring.map(([longitude, latitude], index) => {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 ||
      Math.abs(latitude) > CesiumMath.toDegrees(WebMercatorProjection.MaximumLatitude)) {
      throw new Error('全球遮罩的洞和岛只支持 Web Mercator 范围内的有限经纬度');
    }
    if (index > 0 && Math.abs(longitude - ring[index - 1][0]) > 180) {
      throw new Error('全球遮罩的洞和岛暂不支持跨 180° 经线');
    }
    const point = projection.project(Cartographic.fromDegrees(longitude, latitude));
    return [point.x, point.y];
  });
}

/** 将墨卡托直边细分成地理瓦片折线，弦误差限制在四分之一纹理像素 */
export function maskTilePath(
  ring: readonly Position[], bounds: Rectangle, projection: WebMercatorProjection
): readonly (readonly [number, number])[] {
  const project = (point: Position): readonly [number, number] => {
    const position = projection.unproject(new Cartesian3(point[0], point[1]));
    return [(position.longitude - bounds.west) / Rectangle.computeWidth(bounds) * TILE_SIZE,
      (bounds.north - position.latitude) / Rectangle.computeHeight(bounds) * TILE_SIZE];
  };
  const radius = projection.ellipsoid.maximumRadius;
  const path: (readonly [number, number])[] = [];
  const append = (a: Position, b: Position, start: readonly [number, number], end: readonly [number, number], depth: number) => {
    // 曲线的经纬度均单调；同侧不可见线段不再细分，避免高层级为远处几何浪费精度
    if (outside(start, end)) { path.push(end); return; }
    // 单调曲线不会离开端点的纵向范围；小于误差限的微小边无需计算病态弦斜率
    if (start[0] === end[0] || Math.abs(start[1] - end[1]) <= PIXEL_ERROR) { path.push(end); return; }
    const firstLatitude = projection.unproject(new Cartesian3(a[0], a[1])).latitude;
    const lastLatitude = projection.unproject(new Cartesian3(b[0], b[1])).latitude;
    const slope = (lastLatitude - firstLatitude) / ((b[1] - a[1]) / radius);
    if (!Number.isFinite(slope) || slope <= 0) { throw new Error('全球遮罩的投影弦斜率无效'); }
    // 逆墨卡托导数为 sech(y/R)，弦误差驻点满足导数等于弦斜率；上限取1消除赤道附近舍入误差
    const extreme = radius * Math.acosh(1 / Math.min(1, slope));
    let error = 0;
    for (const pointY of [extreme, -extreme]) {
      const fraction = (pointY - a[1]) / (b[1] - a[1]);
      if (fraction > 0 && fraction < 1) {
        error = Math.max(error, distance(project([a[0] + (b[0] - a[0]) * fraction, pointY]), start, end));
      }
    }
    if (error <= PIXEL_ERROR) { path.push(end); return; }
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const projected = project(middle);
    if (depth === MAX_SUBDIVISION) { throw new Error('全球遮罩的投影细分超出精度限制'); }
    append(a, middle, start, projected, depth + 1);
    append(middle, b, projected, end, depth + 1);
  };
  if (ring.length === 0) { return path; }
  path.push(project(ring[0]));
  for (let index = 1; index < ring.length; index++) {
    append(ring[index - 1], ring[index], project(ring[index - 1]), project(ring[index]), 0);
  }
  return path;
}

function outside(a: readonly [number, number], b: readonly [number, number]): boolean {
  return (a[0] < 0 && b[0] < 0) || (a[0] > TILE_SIZE && b[0] > TILE_SIZE) ||
    (a[1] < 0 && b[1] < 0) || (a[1] > TILE_SIZE && b[1] > TILE_SIZE);
}

// 到无限直线的垂距即可：投影曲线的两个坐标都沿线段方向单调
function distance(point: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const x = b[0] - a[0];
  const y = b[1] - a[1];
  const length = Math.hypot(x, y);
  return length === 0 ? 0 : Math.abs(x * (a[1] - point[1]) - (a[0] - point[0]) * y) / length;
}
