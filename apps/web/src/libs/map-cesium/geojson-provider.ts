import {
  Cartographic, Credit, Event, GeographicTilingScheme, Math as CesiumMath, WebMercatorProjection, WebMercatorTilingScheme,
  type ImageryProvider, type TileProviderError
} from 'cesium';
import type { GeoJSON, Geometry, Position } from 'geojson';
import {
  canvasColor, canvasNumber, drawCanvas, prepareCanvasDrawing,
  type CanvasEnvironment, type CanvasPath, type CanvasProject, type CanvasShape
} from './canvas-renderer';
import { CanvasPatternCache } from './canvas-pattern';
import type { BasicStyleLayer } from './style-plan';
import { createWorldMaskProvider, hasWorldMask } from './world-mask-provider';

type Draw = (context: CanvasRenderingContext2D, project: CanvasProject, scale: number, environment: CanvasEnvironment) => void;

interface PreparedShape extends CanvasShape {
  readonly bounds: readonly [west: number, south: number, east: number, north: number];
}

interface TileDrawing {
  readonly draw: Draw;
  readonly bounds?: PreparedShape['bounds'];
  /** 符号在相机级别下向几何外扩的保守像素范围 */
  readonly padding: number;
}

/** 视图拥有投影缓存，同源图层和缩放重画共享几何，旧数据仍可被回收 */
export class GeoJsonGeometryCache implements Disposable {
  #shapes = new WeakMap<GeoJSON, readonly PreparedShape[]>();
  #disposed = false;

  prepare(data: GeoJSON): readonly PreparedShape[] {
    if (this.#disposed) { throw new Error('GeoJSON 投影缓存已释放'); }
    let prepared = this.#shapes.get(data);
    if (!prepared) {
      prepared = shapes(data, new WebMercatorProjection());
      this.#shapes.set(data, prepared);
    }
    return prepared;
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#shapes = new WeakMap();
  }
}

// 世界像素与 MapLibre 的 512 像素口径一致，瓦片层级不参与样式求值
const TILE_SIZE = 512;
const MAX_LATITUDE = CesiumMath.toDegrees(WebMercatorProjection.MaximumLatitude);

/** 将一个背景或内联 GeoJSON 图层镜像为固定相机级别的透明影像 */
export function createGeoJsonProvider(
  layer: BasicStyleLayer, zoom: number, cache = new GeoJsonGeometryCache()
): ImageryProvider {
  if (!Number.isFinite(zoom)) {
    throw new RangeError('三维样式的相机级别必须是有限数值');
  }
  if (layer.type === 'fill' && layer.source?.type === 'geojson' && typeof layer.source.data !== 'string' &&
    hasWorldMask(layer.source.data)) {
    return createWorldMaskProvider(layer, zoom);
  }
  // 纯色背景覆盖两极，业务几何仍只使用 Web Mercator 的有效范围
  const tilingScheme = layer.type === 'background' ? new GeographicTilingScheme() : new WebMercatorTilingScheme();
  const draws: TileDrawing[] = [];
  if (layer.type === 'background') {
    const color = canvasColor(layer.value('background-color', zoom));
    const opacity = canvasNumber(layer.value('background-opacity', zoom), 'background-opacity', 1);
    draws.push({ padding: 0, draw: context => {
      context.fillStyle = color;
      context.globalAlpha = opacity;
      context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    } });
  } else {
    if (layer.source?.type !== 'geojson' || typeof layer.source.data === 'string') {
      throw new Error('GeoJSON 影像仅支持内联 GeoJSON 数据源');
    }
    for (const shape of cache.prepare(layer.source.data)) {
      if (!layer.accepts(zoom, shape.feature)) {
        continue;
      }
      const draw = prepareCanvasDrawing(layer, shape, zoom);
      if (draw) {
        draws.push({ bounds: shape.bounds, padding: drawingPadding(layer, shape, zoom),
          draw: (context, project, scale, environment) => drawCanvas(context, draw, project, scale, environment) });
      }
    }
  }
  const credit = layer.source?.attribution ? new Credit(layer.source.attribution) : undefined;
  // 纯色背景与完全空层在空间上恒定，根级单像素足够覆盖整个范围
  const uniform = layer.type === 'background' || draws.length === 0;
  let sharedImage: HTMLCanvasElement | undefined;
  const provider = {
    rectangle: tilingScheme.rectangle,
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    minimumLevel: 0,
    maximumLevel: uniform ? 0 : 22,
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
      if (uniform && sharedImage) { return sharedImage; }
      const bounds = tilingScheme.tileXYToNativeRectangle(x, y, level);
      const scale = 2 ** (level - zoom);
      const visible = layer.visible(zoom) ? draws.filter(drawing => {
        if (!drawing.bounds) { return true; }
        // 多留两个纹理像素覆盖抗锯齿，线帽、尖角和模糊由符号范围共同约束
        const padding = drawing.padding * scale + 2;
        const marginX = padding * (bounds.east - bounds.west) / TILE_SIZE;
        const marginY = padding * (bounds.north - bounds.south) / TILE_SIZE;
        const [west, south, east, north] = drawing.bounds;
        return west <= bounds.east + marginX && east >= bounds.west - marginX &&
          south <= bounds.north + marginY && north >= bounds.south - marginY;
      }) : [];
      if (visible.length === 0) {
        if (!sharedImage) {
          sharedImage = document.createElement('canvas');
          sharedImage.width = 1;
          sharedImage.height = 1;
        }
        return sharedImage;
      }
      const canvas = document.createElement('canvas');
      canvas.width = uniform ? 1 : TILE_SIZE;
      canvas.height = uniform ? 1 : TILE_SIZE;
      // 微小虚线的 GPU 栅格化开销很大，离屏瓦片使用软件画布后仍按原样上传纹理
      const context = canvas.getContext('2d', { willReadFrequently: layer.type === 'line' });
      if (!context) {
        throw new Error('无法创建三维样式的二维画布');
      }
      if (layer.visible(zoom)) {
        const project: CanvasProject = (pointX, pointY) => [
          (pointX - bounds.west) / (bounds.east - bounds.west) * TILE_SIZE,
          (bounds.north - pointY) / (bounds.north - bounds.south) * TILE_SIZE
        ];
        const environment = { origin: [x * TILE_SIZE, y * TILE_SIZE] as const, patterns: new CanvasPatternCache() };
        for (const { draw } of visible) {
          context.save();
          draw(context, project, scale, environment);
          context.restore();
        }
      }
      if (uniform) { sharedImage = canvas; }
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
function shapes(data: GeoJSON, projection: WebMercatorProjection): readonly PreparedShape[] {
  const result: PreparedShape[] = [];
  const append = (geometry: Geometry | null, properties: Record<string, unknown>, id?: string | number): void => {
    if (!geometry) {
      return;
    }
    const add = (type: CanvasShape['type'], coordinates: Position[][]): void => {
      const paths = coordinates.map(path => projectPath(path, projection, type));
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const path of paths) {
        for (let index = 0; index < path.length; index += 2) {
          west = Math.min(west, path[index]); east = Math.max(east, path[index]);
          south = Math.min(south, path[index + 1]); north = Math.max(north, path[index + 1]);
        }
      }
      result.push({ type, paths, bounds: [west, south, east, north], feature: { type, properties, id } });
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

// 与绘制器的可见线段范围一致，粗筛只排除不可能覆盖当前瓦片的几何
function drawingPadding(layer: BasicStyleLayer, shape: CanvasShape, zoom: number): number {
  const value = (property: string) => layer.value(property, zoom, shape.feature);
  if (layer.type === 'circle') {
    return canvasNumber(value('circle-radius'), 'circle-radius') +
      canvasNumber(value('circle-stroke-width'), 'circle-stroke-width');
  }
  if (layer.type === 'line') {
    return canvasNumber(value('line-width'), 'line-width') *
      Math.max(2, canvasNumber(value('line-miter-limit'), 'line-miter-limit')) +
      canvasNumber(value('line-blur') ?? 0, 'line-blur') * 3;
  }
  // 面描边宽度为 scale，Canvas 默认 miterLimit 10 的尖角最多外扩 5 * scale
  return value('fill-antialias') === true ? 5 : 0;
}

// 明确拒绝跨经线与极区路径，不把世界遮罩或长环改写成局部多边形
function projectPath(path: Position[], projection: WebMercatorProjection, type: CanvasShape['type']): CanvasPath {
  if (path.length > 0 && ((type === 'Polygon' && path.length < 4) || (type === 'LineString' && path.length < 2))) {
    throw new Error('GeoJSON 路径的坐标数量不足');
  }
  if (type === 'Polygon' && path.length > 0 &&
    (path[0][0] !== path.at(-1)?.[0] || path[0][1] !== path.at(-1)?.[1])) {
    throw new Error('GeoJSON 多边形必须是闭合环');
  }
  return path.flatMap((position, index) => {
    const [longitude, latitude] = position;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 || Math.abs(latitude) > MAX_LATITUDE) {
      throw new Error('三维基础影像只支持 Web Mercator 范围内的有限经纬度');
    }
    if (index > 0 && Math.abs(longitude - path[index - 1][0]) > 180) {
      throw new Error('三维基础影像暂不支持跨 180° 经线的路径或世界遮罩');
    }
    const point = projection.project(Cartographic.fromDegrees(longitude, latitude));
    return [point.x, point.y];
  });
}
