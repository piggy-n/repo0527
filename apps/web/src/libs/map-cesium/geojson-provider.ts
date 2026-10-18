import { Color, type Feature as StyleFeature } from '@maplibre/maplibre-gl-style-spec';
import {
  Cartographic, Credit, Event, GeographicTilingScheme, Math as CesiumMath, WebMercatorProjection, WebMercatorTilingScheme,
  type Cartesian3, type ImageryProvider, type TileProviderError
} from 'cesium';
import type { GeoJSON, Geometry, Position } from 'geojson';
import type { BasicStyleLayer } from './style-plan';

type Path = readonly Cartesian3[];
type Pixel = readonly [number, number];
type ProjectPixel = (point: Cartesian3) => Pixel;
type Draw = (context: CanvasRenderingContext2D, project: ProjectPixel, scale: number) => void;

interface Shape {
  readonly type: 'Point' | 'LineString' | 'Polygon';
  readonly paths: readonly Path[];
  readonly feature: StyleFeature;
}

// 世界像素与 MapLibre 的 512 像素口径一致，瓦片层级不参与样式求值
const TILE_SIZE = 512;
const MAX_LATITUDE = CesiumMath.toDegrees(WebMercatorProjection.MaximumLatitude);

/** 将一个背景或内联 GeoJSON 图层镜像为固定相机级别的透明影像 */
export function createGeoJsonProvider(layer: BasicStyleLayer, zoom: number): ImageryProvider {
  if (!Number.isFinite(zoom)) {
    throw new RangeError('三维样式的相机级别必须是有限数值');
  }
  // 纯色背景覆盖两极，业务几何仍只使用 Web Mercator 的有效范围
  const tilingScheme = layer.type === 'background' ? new GeographicTilingScheme() : new WebMercatorTilingScheme();
  const projection = new WebMercatorProjection(tilingScheme.ellipsoid);
  const draws: Draw[] = [];
  if (layer.type === 'background') {
    const color = styleColor(layer.value('background-color', zoom));
    const opacity = styleNumber(layer.value('background-opacity', zoom), 'background-opacity', 1);
    draws.push(context => {
      context.fillStyle = color;
      context.globalAlpha = opacity;
      context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    });
  } else {
    if (layer.source?.type !== 'geojson' || typeof layer.source.data === 'string') {
      throw new Error('GeoJSON 影像仅支持内联 GeoJSON 数据源');
    }
    for (const shape of shapes(layer.source.data, projection)) {
      if (!layer.accepts(zoom, shape.feature)) {
        continue;
      }
      const draw = shapeDraw(layer, shape, zoom);
      if (draw) {
        draws.push(draw);
      }
    }
  }
  const credit = layer.source?.attribution ? new Credit(layer.source.attribution) : undefined;
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
    // SDK 只把 Promise rejection 转为数据源错误，同步绘制失败也须进入这条隔离通道
    requestImage: async (x, y, level) => {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('无法创建三维样式的二维画布');
      }
      if (layer.visible(zoom)) {
        const bounds = tilingScheme.tileXYToNativeRectangle(x, y, level);
        const project: ProjectPixel = point => [
          (point.x - bounds.west) / (bounds.east - bounds.west) * TILE_SIZE,
          (bounds.north - point.y) / (bounds.north - bounds.south) * TILE_SIZE
        ];
        const scale = 2 ** (level - zoom);
        for (const draw of draws) {
          context.save();
          draw(context, project, scale);
          context.restore();
        }
      }
      return canvas;
    }
  } satisfies Omit<ImageryProvider, 'tileDiscardPolicy' | 'credit' | 'proxy' | 'getTileCredits'> & {
    tileDiscardPolicy: undefined;
    credit: Credit | undefined;
    proxy: undefined;
    getTileCredits(): undefined;
  };
  // SDK 的这些可选值在真实提供者中允许 undefined，但发布类型未标注可选
  return provider as unknown as ImageryProvider;
}

// 多部件几何拆为简单几何，过滤器沿用矢量瓦片的 Point / LineString / Polygon 类型
function shapes(data: GeoJSON, projection: WebMercatorProjection): Shape[] {
  const result: Shape[] = [];
  const append = (geometry: Geometry | null, properties: Record<string, unknown>, id?: string | number): void => {
    if (!geometry) {
      return;
    }
    const add = (type: Shape['type'], coordinates: Position[][]): void => {
      const paths = coordinates.map(path => projectPath(path, projection, type));
      result.push({ type, paths, feature: { type, properties, id } });
    };
    switch (geometry.type) {
      case 'Point': add('Point', [[geometry.coordinates]]); break;
      case 'MultiPoint':
        for (const point of geometry.coordinates) { add('Point', [[point]]); }
        break;
      case 'LineString': add('LineString', [geometry.coordinates]); break;
      case 'MultiLineString':
        for (const line of geometry.coordinates) { add('LineString', [line]); }
        break;
      case 'Polygon': add('Polygon', geometry.coordinates); break;
      case 'MultiPolygon':
        for (const polygon of geometry.coordinates) { add('Polygon', polygon); }
        break;
      case 'GeometryCollection':
        for (const child of geometry.geometries) { append(child, properties, id); }
        break;
    }
  };
  if (data.type === 'FeatureCollection') {
    for (const feature of data.features) {
      append(feature.geometry, feature.properties ?? {}, feature.id);
    }
  } else if (data.type === 'Feature') {
    append(data.geometry, data.properties ?? {}, data.id);
  } else {
    append(data, {});
  }
  return result;
}

// 明确拒绝跨经线与极区路径，不把世界遮罩或长环改写成局部多边形
function projectPath(path: Position[], projection: WebMercatorProjection, type: Shape['type']): Path {
  if (path.length > 0 && ((type === 'Polygon' && path.length < 4) || (type === 'LineString' && path.length < 2))) {
    throw new Error('GeoJSON 路径的坐标数量不足');
  }
  if (type === 'Polygon' && path.length > 0 &&
    (path[0][0] !== path.at(-1)?.[0] || path[0][1] !== path.at(-1)?.[1])) {
    throw new Error('GeoJSON 多边形必须是闭合环');
  }
  return path.map((position, index) => {
    const [longitude, latitude] = position;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 || Math.abs(latitude) > MAX_LATITUDE) {
      throw new Error('三维基础影像只支持 Web Mercator 范围内的有限经纬度');
    }
    if (index > 0 && Math.abs(longitude - path[index - 1][0]) > 180) {
      throw new Error('三维基础影像暂不支持跨 180° 经线的路径或世界遮罩');
    }
    return projection.project(Cartographic.fromDegrees(longitude, latitude));
  });
}

function shapeDraw(layer: BasicStyleLayer, shape: Shape, zoom: number): Draw | undefined {
  const value = (property: string): unknown => layer.value(property, zoom, shape.feature);
  if (layer.type === 'fill' && shape.type === 'Polygon') {
    if (value('fill-antialias') !== true) {
      throw new Error('Canvas 基础填充暂不支持关闭 fill-antialias');
    }
    const fill = styleColor(value('fill-color'));
    const outline = styleColor(value('fill-outline-color') ?? value('fill-color'));
    const opacity = styleNumber(value('fill-opacity'), 'fill-opacity', 1);
    return (context, project, scale) => {
      drawPaths(context, shape.paths, project, true);
      context.fillStyle = fill;
      context.globalAlpha = opacity;
      context.fill('evenodd');
      context.strokeStyle = outline;
      context.lineWidth = scale;
      context.stroke();
    };
  }
  if (layer.type === 'line' && shape.type !== 'Point') {
    const color = styleColor(value('line-color'));
    const opacity = styleNumber(value('line-opacity'), 'line-opacity', 1);
    const width = styleNumber(value('line-width'), 'line-width');
    const cap = value('line-cap');
    const join = value('line-join');
    if (cap !== 'butt' && cap !== 'round' && cap !== 'square') {
      throw new Error('无效的 line-cap');
    }
    if (join !== 'miter' && join !== 'round' && join !== 'bevel') {
      throw new Error('无效的 line-join');
    }
    const miterLimit = styleNumber(value('line-miter-limit'), 'line-miter-limit');
    return (context, project, scale) => {
      if (width === 0) { return; }
      drawPaths(context, shape.paths, project, shape.type === 'Polygon');
      context.strokeStyle = color;
      context.globalAlpha = opacity;
      context.lineWidth = width * scale;
      context.lineCap = cap;
      // Canvas 忽略零 miterLimit，规范中的零表示全部尖角转为 bevel
      context.lineJoin = join === 'miter' && miterLimit === 0 ? 'bevel' : join;
      if (miterLimit > 0) {
        context.miterLimit = miterLimit;
      }
      context.stroke();
    };
  }
  if (layer.type === 'circle' && shape.type === 'Point') {
    const fill = styleColor(value('circle-color'));
    const opacity = styleNumber(value('circle-opacity'), 'circle-opacity', 1);
    const radius = styleNumber(value('circle-radius'), 'circle-radius');
    const stroke = styleColor(value('circle-stroke-color'));
    const strokeOpacity = styleNumber(value('circle-stroke-opacity'), 'circle-stroke-opacity', 1);
    const strokeWidth = styleNumber(value('circle-stroke-width'), 'circle-stroke-width');
    return (context, project, scale) => {
      const [x, y] = project(shape.paths[0][0]);
      context.beginPath();
      context.arc(x, y, radius * scale, 0, 2 * Math.PI);
      context.fillStyle = fill;
      context.globalAlpha = opacity;
      context.fill();
      if (strokeWidth > 0) {
        context.beginPath();
        context.arc(x, y, (radius + strokeWidth / 2) * scale, 0, 2 * Math.PI);
        context.strokeStyle = stroke;
        context.globalAlpha = strokeOpacity;
        context.lineWidth = strokeWidth * scale;
        context.stroke();
      }
    };
  }
  return undefined;
}

// 完整路径交给画布边界裁剪，不在瓦片边缘新增端点或闭合边
function drawPaths(
  context: CanvasRenderingContext2D,
  paths: readonly Path[],
  project: ProjectPixel,
  closed: boolean
): void {
  context.beginPath();
  for (const path of paths) {
    if (path.length === 0) { continue; }
    context.moveTo(...project(path[0]));
    for (const point of path.slice(1)) {
      context.lineTo(...project(point));
    }
    if (closed) { context.closePath(); }
  }
}

function styleColor(value: unknown): string {
  if (!(value instanceof Color)) {
    throw new Error('三维基础样式颜色必须由规范库求值');
  }
  // Color 的 RGB 已预乘透明度，使用官方输出避免重复乘 alpha
  return value.toString();
}

function styleNumber(value: unknown, property: string, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`三维基础样式 ${property} 超出有效范围`);
  }
  return value;
}
