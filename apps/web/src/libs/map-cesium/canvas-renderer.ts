import { Color, ResolvedImage, type Feature } from '@maplibre/maplibre-gl-style-spec';
import { CanvasPatternCache, patternTransform } from './canvas-pattern';
import { visibleLinePaths } from './line-path';
import type { BasicStyleLayer } from './style-plan';

/** 窄画布接口同时接受主线程 Canvas 和 Worker 的 OffscreenCanvas */
export type CanvasContext = Pick<OffscreenCanvasRenderingContext2D,
  'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'arc' | 'save' | 'restore' |
  'fillStyle' | 'strokeStyle' | 'globalAlpha' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'miterLimit' |
  'setLineDash' | 'lineDashOffset' | 'shadowBlur' | 'shadowColor'> & {
    readonly canvas: { readonly width: number; readonly height: number };
    readonly fill: (rule?: CanvasFillRule) => void;
    readonly clip: (rule?: CanvasFillRule) => void;
    readonly stroke: () => void;
    readonly createPattern: (image: OffscreenCanvas, repetition: string | null) => CanvasPattern | null;
    readonly drawImage: (image: OffscreenCanvas, x: number, y: number) => void;
  };
export type CanvasPath = ArrayLike<number>;
export type CanvasProject = (x: number, y: number) => readonly [number, number];
export interface CanvasEnvironment {
  /** 当前局部画布在世界像素中的左上位置 */
  readonly origin?: readonly [number, number];
  readonly patterns?: CanvasPatternCache;
}
export type CanvasDrawing = (
  context: CanvasContext, project: CanvasProject, scale: number, environment: CanvasEnvironment
) => Generator<void>;

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
    const antialias = value('fill-antialias') === true;
    const color = value('fill-color');
    const fill = canvasColor(color);
    const outline = canvasColor(value('fill-outline-color') ?? value('fill-color'));
    const opacity = canvasNumber(value('fill-opacity'), 'fill-opacity', 1);
    const pattern = value('fill-pattern');
    if (pattern !== undefined && pattern !== null && !(pattern instanceof ResolvedImage)) {
      throw new Error('fill-pattern 必须由规范库求值为图片引用');
    }
    const image = pattern instanceof ResolvedImage ? layer.images[pattern.name] : undefined;
    if (pattern instanceof ResolvedImage && !image) { throw new Error(`缺少花纹图片：${pattern.name}`); }
    const paint = (context: CanvasContext, scale: number, environment: CanvasEnvironment): string | CanvasPattern => {
      if (!image) { return fill; }
      if (!(color instanceof Color)) { throw new Error('花纹颜色必须由规范库求值'); }
      const canvas = (environment.patterns ?? new CanvasPatternCache()).image(image, color, scale);
      const repeated = context.createPattern(canvas, 'repeat');
      if (!repeated) { throw new Error('无法创建三维重复花纹'); }
      repeated.setTransform(patternTransform(image, scale, environment.origin ?? [0, 0]));
      return repeated;
    };
    return function* (context, project, scale, environment) {
      if (!antialias) {
        yield* drawHardFill(context, shape.paths, project, opacity, (local, left, top) => paint(local, scale, {
          ...environment, origin: [(environment.origin?.[0] ?? 0) + left, (environment.origin?.[1] ?? 0) + top]
        }));
        return;
      }
      yield* drawPaths(context, shape.paths, project, true);
      context.fillStyle = paint(context, scale, environment);
      context.globalAlpha = opacity;
      context.fill('evenodd');
      context.strokeStyle = image ? context.fillStyle : outline;
      context.lineWidth = scale;
      context.stroke();
    };
  }
  if (layer.type === 'line' && shape.type !== 'Point') {
    const color = canvasColor(value('line-color'));
    const opacity = canvasNumber(value('line-opacity'), 'line-opacity', 1);
    const width = canvasNumber(value('line-width'), 'line-width');
    const dash = canvasDash(value('line-dasharray'));
    const offset = value('line-offset') ?? 0;
    if (typeof offset !== 'number' || !Number.isFinite(offset) ||
      (offset !== 0 && (shape.type !== 'Polygon' || offset !== width / 2))) {
      throw new Error('三维 line-offset 仅支持 0 或面描边内收半个线宽');
    }
    const blur = canvasNumber(value('line-blur') ?? 0, 'line-blur');
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
      if (offset !== 0) {
        yield* drawPaths(context, shape.paths, project, true);
        context.clip('evenodd');
      }
      context.strokeStyle = color;
      context.globalAlpha = opacity;
      context.lineWidth = width * scale * (offset === 0 ? 1 : 2);
      context.setLineDash([]);
      context.lineDashOffset = 0;
      context.shadowColor = blur > 0 ? color : 'transparent';
      context.shadowBlur = blur * scale;
      context.lineCap = cap;
      // Canvas 忽略零 miterLimit，规范中的零表示全部尖角转为 bevel
      context.lineJoin = join === 'miter' && miterLimit === 0 ? 'bevel' : join;
      if (miterLimit > 0) { context.miterLimit = miterLimit; }
      const padding = width * scale * Math.max(2, miterLimit) + blur * scale * 3 + 2;
      const bounds: [number, number, number, number] = [
        -padding, -padding, context.canvas.width + padding, context.canvas.height + padding
      ];
      context.beginPath();
      for (const path of visibleLinePaths(shape.paths, project, bounds, shape.type === 'Polygon',
        dash.map(length => length * width * scale))) {
        if (!path) { yield; continue; }
        yield* drawPaths(context, [path.points], (x, y) => [x, y], path.closed, false);
      }
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
export function drawCanvas(
  context: CanvasContext, draw: CanvasDrawing, project: CanvasProject, scale: number, environment: CanvasEnvironment = {}
): void {
  context.save();
  try {
    const iterator = draw(context, project, scale, environment);
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
  checkpoint: () => Promise<void>,
  environment: CanvasEnvironment = {}
): Promise<void> {
  context.save();
  try {
    const iterator = draw(context, project, scale, environment);
    while (!iterator.next().done) {
      // oxlint-disable-next-line no-await-in-loop -- 长路径绘制必须分段让出，不能并行修改同一个画布路径
      await checkpoint();
    }
  } finally {
    context.restore();
  }
}

// Canvas 路径不能关闭边缘抗锯齿：局部面蒙版二值化以后再着色，孔洞仍保持透明
function* drawHardFill(
  context: CanvasContext,
  paths: readonly CanvasPath[],
  project: CanvasProject,
  opacity: number,
  paint: (context: CanvasContext, left: number, top: number) => string | CanvasPattern
): Generator<void> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let vertices = 0;
  for (const path of paths) {
    for (let index = 0; index < path.length; index += 2) {
      const [x, y] = project(path[index], path[index + 1]);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (++vertices % VERTICES_PER_CHECKPOINT === 0) { yield; }
    }
  }
  if (!Number.isFinite(minX)) { return; }
  const left = Math.max(0, Math.floor(minX));
  const top = Math.max(0, Math.floor(minY));
  const width = Math.min(context.canvas.width, Math.ceil(maxX)) - left;
  const height = Math.min(context.canvas.height, Math.ceil(maxY)) - top;
  if (width <= 0 || height <= 0) { return; }
  const canvas = new OffscreenCanvas(width, height);
  const mask = canvas.getContext('2d');
  if (!mask) { throw new Error('无法创建三维填充蒙版'); }
  yield* drawPaths(mask, paths, (x, y) => {
    const point = project(x, y);
    return [point[0] - left, point[1] - top];
  }, true);
  mask.fill('evenodd');
  const pixels = mask.getImageData(0, 0, width, height);
  for (let index = 3; index < pixels.data.length; index += 4) {
    pixels.data[index] = pixels.data[index] >= 128 ? 255 : 0;
    if (index % 65536 === 65535) { yield; }
  }
  mask.putImageData(pixels, 0, 0);
  mask.globalCompositeOperation = 'source-in';
  mask.fillStyle = paint(mask, left, top);
  mask.fillRect(0, 0, width, height);
  context.globalAlpha = opacity;
  context.drawImage(canvas, left, top);
}

// 规范库已校验类型，这里同时守住画布不能接受的全零虚线
function canvasDash(value: unknown): readonly number[] {
  if (value === undefined || value === null) { return []; }
  if (!Array.isArray(value) || value.length === 0 ||
    value.some((item: unknown) => typeof item !== 'number' || !Number.isFinite(item) || item < 0) ||
    !value.some((item: unknown) => typeof item === 'number' && item > 0)) {
    throw new Error('line-dasharray 必须包含有效的非负长度，且不能全为零');
  }
  return value as number[];
}

// 完整路径交给画布边界裁剪，不在瓦片边缘新增端点或闭合边
function* drawPaths(
  context: CanvasContext,
  paths: readonly CanvasPath[],
  project: CanvasProject,
  closed: boolean,
  begin = true
): Generator<void> {
  if (begin) { context.beginPath(); }
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
