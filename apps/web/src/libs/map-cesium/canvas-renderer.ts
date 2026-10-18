import { Color, type Feature } from '@maplibre/maplibre-gl-style-spec';
import type { BasicStyleLayer } from './style-plan';

/** 窄画布接口同时接受主线程 Canvas 和 Worker 的 OffscreenCanvas */
export type CanvasContext = Pick<OffscreenCanvasRenderingContext2D,
  'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'arc' | 'save' | 'restore' |
  'fillStyle' | 'strokeStyle' | 'globalAlpha' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'miterLimit'> & {
    readonly fill: (rule?: CanvasFillRule) => void;
    readonly stroke: () => void;
  };
export type CanvasPath = ArrayLike<number>;
export type CanvasProject = (x: number, y: number) => readonly [number, number];
export type CanvasDrawing = (context: CanvasContext, project: CanvasProject, scale: number) => Generator<void>;

export interface CanvasShape {
  readonly type: 'Point' | 'LineString' | 'Polygon';
  readonly paths: readonly CanvasPath[];
  readonly feature: Feature;
}

// 长路径让出事件循环的粒度，不把一个复杂要素当成不可取消的任务
const VERTICES_PER_CHECKPOINT = 256;

/** 预先求值样式，绘制时只接收局部坐标投影和像素比例 */
export function prepareCanvasDrawing(layer: BasicStyleLayer, shape: CanvasShape, zoom: number): CanvasDrawing | undefined {
  const value = (property: string): unknown => layer.value(property, zoom, shape.feature);
  if (layer.type === 'fill' && shape.type === 'Polygon') {
    if (value('fill-antialias') !== true) {
      throw new Error('Canvas 基础填充暂不支持关闭 fill-antialias');
    }
    const fill = canvasColor(value('fill-color'));
    const outline = canvasColor(value('fill-outline-color') ?? value('fill-color'));
    const opacity = canvasNumber(value('fill-opacity'), 'fill-opacity', 1);
    return function* (context, project, scale) {
      yield* drawPaths(context, shape.paths, project, true);
      context.fillStyle = fill;
      context.globalAlpha = opacity;
      context.fill('evenodd');
      context.strokeStyle = outline;
      context.lineWidth = scale;
      context.stroke();
    };
  }
  if (layer.type === 'line' && shape.type !== 'Point') {
    const color = canvasColor(value('line-color'));
    const opacity = canvasNumber(value('line-opacity'), 'line-opacity', 1);
    const width = canvasNumber(value('line-width'), 'line-width');
    const cap = value('line-cap');
    const join = value('line-join');
    if (cap !== 'butt' && cap !== 'round' && cap !== 'square') {
      throw new Error('无效的 line-cap');
    }
    if (join !== 'miter' && join !== 'round' && join !== 'bevel') {
      throw new Error('无效的 line-join');
    }
    const miterLimit = canvasNumber(value('line-miter-limit'), 'line-miter-limit');
    return function* (context, project, scale) {
      if (width === 0) { return; }
      yield* drawPaths(context, shape.paths, project, shape.type === 'Polygon');
      context.strokeStyle = color;
      context.globalAlpha = opacity;
      context.lineWidth = width * scale;
      context.lineCap = cap;
      // Canvas 忽略零 miterLimit，规范中的零表示全部尖角转为 bevel
      context.lineJoin = join === 'miter' && miterLimit === 0 ? 'bevel' : join;
      if (miterLimit > 0) { context.miterLimit = miterLimit; }
      context.stroke();
    };
  }
  if (layer.type === 'circle' && shape.type === 'Point') {
    const fill = canvasColor(value('circle-color'));
    const opacity = canvasNumber(value('circle-opacity'), 'circle-opacity', 1);
    const radius = canvasNumber(value('circle-radius'), 'circle-radius');
    const stroke = canvasColor(value('circle-stroke-color'));
    const strokeOpacity = canvasNumber(value('circle-stroke-opacity'), 'circle-stroke-opacity', 1);
    const strokeWidth = canvasNumber(value('circle-stroke-width'), 'circle-stroke-width');
    return function* (context, project, scale) {
      let vertices = 0;
      for (const path of shape.paths) {
        for (let index = 0; index < path.length; index += 2) {
          const [x, y] = project(path[index], path[index + 1]);
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
          vertices++;
          if (vertices % VERTICES_PER_CHECKPOINT === 0) { yield; }
        }
      }
    };
  }
  return undefined;
}

/** 小型内联 GeoJSON 保持同步绘制，共用同一套绘制语义 */
export function drawCanvas(context: CanvasContext, draw: CanvasDrawing, project: CanvasProject, scale: number): void {
  context.save();
  try {
    const iterator = draw(context, project, scale);
    while (!iterator.next().done) { /* 同步调用方不需要让出事件循环 */ }
  } finally {
    context.restore();
  }
}

/** Worker 在长路径之间让出事件循环，并在每次绘制后交回取消检查 */
export async function drawCanvasCooperatively(
  context: CanvasContext,
  draw: CanvasDrawing,
  project: CanvasProject,
  scale: number,
  checkpoint: () => Promise<void>
): Promise<void> {
  context.save();
  try {
    const iterator = draw(context, project, scale);
    while (!iterator.next().done) {
      // oxlint-disable-next-line no-await-in-loop -- 长路径绘制必须分段让出，不能并行修改同一个画布路径
      await checkpoint();
    }
  } finally {
    context.restore();
  }
}

// 完整路径交给画布边界裁剪，不在瓦片边缘新增端点或闭合边
function* drawPaths(
  context: CanvasContext,
  paths: readonly CanvasPath[],
  project: CanvasProject,
  closed: boolean
): Generator<void> {
  context.beginPath();
  let vertices = 0;
  for (const path of paths) {
    if (path.length === 0) { continue; }
    context.moveTo(...project(path[0], path[1]));
    for (let index = 2; index < path.length; index += 2) {
      context.lineTo(...project(path[index], path[index + 1]));
      vertices++;
      if (vertices % VERTICES_PER_CHECKPOINT === 0) { yield; }
    }
    if (closed) { context.closePath(); }
  }
}

export function canvasColor(value: unknown): string {
  if (!(value instanceof Color)) {
    throw new Error('三维基础样式颜色必须由规范库求值');
  }
  // Color 的 RGB 已预乘透明度，使用官方输出避免重复乘 alpha
  return value.toString();
}

export function canvasNumber(value: unknown, property: string, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`三维基础样式 ${property} 超出有效范围`);
  }
  return value;
}
