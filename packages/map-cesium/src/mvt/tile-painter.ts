import type { PatternImage } from './mvt-protocol';
import type { TileFeature } from './tile-geometry';
import type { CirclePaint, CompiledLayer, FillPaint, LinePaint, Paint } from './tile-style';

// 方案 B 的 PoC：把一张瓦片的要素按图层画到 OffscreenCanvas（移植自旧项目的 tileRenderer.js）

// 每攒这么多要素换一条路径：Path2D 累加子路径是二次复杂度，旧项目实测 2 万个要素一条路径 823 毫秒、分批后 28 毫秒
const BATCH_SIZE = 500;

// 裁掉完全在子瓦片外的要素时留的余量（像素）：线宽、圆的半径
const CULL_MARGIN = 16;

// 花纹的距离场：边缘在 0.75，每 2 个图片像素降 0.25（应用的 fill-patterns.ts 这样生成，MapLibre 的 SDF 约定）
const SDF_EDGE = 0.75;
const SDF_PIXELS_PER_UNIT = 8;

/** 画的是瓦片的哪一块：超过数据源最大级别时是父瓦片的一个子区域 */
export interface TileFrame {
  /** 位图的边长 */
  readonly size: number;
  /** 父瓦片每个方向切成几份（没超过最大级别时是 1），和这一块的列、行 */
  readonly factor: number;
  readonly column: number;
  readonly row: number;
}

type Context = OffscreenCanvasRenderingContext2D;

/** 花纹：按"图片 + 颜色"着色一次，之后每张瓦片只建 CanvasPattern */
export class PatternStore {
  readonly #images: Readonly<Record<string, PatternImage>>;
  readonly #tinted = new Map<string, { readonly canvas: OffscreenCanvas; readonly scale: number } | null>();

  constructor(images: Readonly<Record<string, PatternImage>>) {
    this.#images = images;
  }

  pattern(context: Context, id: string, color: string | null): CanvasPattern | null {
    const key = `${id}|${color}`;
    let tinted = this.#tinted.get(key);
    if (tinted === undefined) {
      tinted = this.#tint(id, color);
      this.#tinted.set(key, tinted);
    }
    if (!tinted) {
      return null;
    }
    const pattern = context.createPattern(tinted.canvas, 'repeat');
    pattern?.setTransform({ a: tinted.scale, d: tinted.scale });
    return pattern;
  }

  // SDF 图片按距离场算覆盖率、用图层的颜色着色；普通图片原样用。全透明的（没有花纹的取值用的空白图片）不画
  #tint(id: string, color: string | null): { canvas: OffscreenCanvas; scale: number } | null {
    const image = this.#images[id];
    if (!image || (image.sdf && color === null)) {
      return null;
    }
    const { width, height, data } = image;
    const pixels = new ImageData(width, height);
    let visible = false;
    if (image.sdf) {
      const [r = 0, g = 0, b = 0, a = 1] = (color ?? '').match(/[\d.]+/g)?.map(Number) ?? [];
      for (let index = 0; index < width * height; index++) {
        const distance = ((data[index * 4 + 3] ?? 0) / 255 - SDF_EDGE) * SDF_PIXELS_PER_UNIT;
        const coverage = Math.min(1, Math.max(0, distance + 0.5));
        pixels.data.set([r, g, b, Math.round(coverage * a * 255)], index * 4);
        visible ||= coverage > 0;
      }
    } else {
      pixels.data.set(data);
      visible = true;
    }
    if (!visible) {
      return null;
    }
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.putImageData(pixels, 0, 0);
    return { canvas, scale: 1 / (image.pixelRatio ?? 1) };
  }
}

interface Bucket {
  readonly paints: readonly Paint[];
  readonly paths: Path2D[];
  /** 圆的描边画在半径外面，另用一条路径 */
  readonly strokes: Path2D[];
  /** 桶里都是面：描边可以内收 */
  readonly closed: boolean;
  count: number;
}

// 相邻的 fill、line 图层吃同一批要素时合成一组，路径只建一次（面的底色、花纹、描边就是这种关系）；circle 各自一组
function groupLayers(layers: readonly CompiledLayer[]): CompiledLayer[][] {
  const groups: CompiledLayer[][] = [];
  for (const layer of layers) {
    const current = groups.at(-1);
    const [head] = current ?? [];
    if (current && head && layer.type !== 'circle' && head.type !== 'circle' && head.groupKey === layer.groupKey) {
      current.push(layer);
    } else {
      groups.push([layer]);
    }
  }
  return groups;
}

// 一组图层吃哪些几何：fill 只吃面，line 吃线和面的边，circle 只吃点（二维的图层都用 geometry-type 限定过）
function accepts(head: CompiledLayer, feature: TileFeature): boolean {
  if (head.type === 'fill') {
    return feature.type === 3;
  }
  return head.type === 'line' ? feature.type !== 1 : feature.type === 1;
}

function appendRings(path: Path2D, { rings, type }: TileFeature, scale: number, offsetX: number, offsetY: number): void {
  for (const ring of rings) {
    if (ring.length < 2) {
      continue;
    }
    path.moveTo(((ring[0] ?? 0) - offsetX) * scale, ((ring[1] ?? 0) - offsetY) * scale);
    for (let index = 2; index < ring.length; index += 2) {
      path.lineTo(((ring[index] ?? 0) - offsetX) * scale, ((ring[index + 1] ?? 0) - offsetY) * scale);
    }
    if (type === 3) {
      path.closePath();
    }
  }
}

function appendCircles(bucket: Bucket, paint: CirclePaint, feature: TileFeature, scale: number, offsetX: number, offsetY: number): void {
  const radius = Math.max(0.5, paint.radius);
  const outer = radius + paint.strokeWidth / 2;
  for (const ring of feature.rings) {
    for (let index = 0; index < ring.length; index += 2) {
      const x = ((ring[index] ?? 0) - offsetX) * scale;
      const y = ((ring[index + 1] ?? 0) - offsetY) * scale;
      const fill = bucket.paths.at(-1);
      const stroke = bucket.strokes.at(-1);
      fill?.moveTo(x + radius, y);
      fill?.arc(x, y, radius, 0, Math.PI * 2);
      stroke?.moveTo(x + outer, y);
      stroke?.arc(x, y, outer, 0, Math.PI * 2);
    }
  }
}

function strokeThin(context: Context, path: Path2D, color: string): void {
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.lineJoin = 'round';
  context.setLineDash([]);
  context.stroke(path);
}

function paintFill(context: Context, paint: FillPaint, path: Path2D, patterns: PatternStore): void {
  if (paint.opacity <= 0) {
    return;
  }
  context.globalAlpha = Math.min(1, paint.opacity);
  if (paint.pattern !== null) {
    const pattern = patterns.pattern(context, paint.pattern, paint.color);
    if (pattern) {
      context.fillStyle = pattern;
      context.fill(path, 'nonzero');
    }
    return;
  }
  if (paint.color === null) {
    return;
  }
  // 外环和洞的绕向相反，nonzero 正好把洞挖掉；evenodd 会把同一批里相邻图斑的细微重叠也当成洞
  context.fillStyle = paint.color;
  context.fill(path, 'nonzero');
  if (paint.outline !== 'none') {
    // MapLibre 的 fill-antialias：1 像素的描边，没写颜色时跟填充色
    strokeThin(context, path, paint.outline === 'fill' ? paint.color : paint.outline);
  } else if (paint.opaque) {
    // 画布的抗锯齿让不同批次的相邻图斑之间露出底色（各盖半个像素），不透明时用同色描一遍补上；
    // 半透明时补了会在边上叠深，不补
    strokeThin(context, path, paint.color);
  }
}

function paintLine(context: Context, paint: LinePaint, path: Path2D, closed: boolean): void {
  if (paint.color === null || paint.width <= 0 || paint.opacity <= 0) {
    return;
  }
  context.save();
  context.globalAlpha = Math.min(1, paint.opacity);
  context.strokeStyle = paint.color;
  context.lineJoin = paint.join;
  context.lineCap = paint.cap;
  context.setLineDash(paint.dash ? paint.dash.map(value => Math.max(0, value) * paint.width) : []);
  // 面的描边内收半个线宽（二维用 line-offset）：裁到面自己，再用两倍线宽描
  if (closed && paint.offset > 0) {
    context.clip(path, 'nonzero');
    context.lineWidth = paint.width * 2;
  } else {
    context.lineWidth = paint.width;
  }
  context.stroke(path);
  context.restore();
}

function paintCircle(context: Context, paint: CirclePaint, fill: Path2D, stroke: Path2D | undefined): void {
  if (paint.color !== null && paint.opacity > 0) {
    context.globalAlpha = Math.min(1, paint.opacity);
    context.fillStyle = paint.color;
    context.fill(fill, 'nonzero');
  }
  if (stroke && paint.strokeColor !== null && paint.strokeWidth > 0 && paint.strokeOpacity > 0) {
    context.globalAlpha = Math.min(1, paint.strokeOpacity);
    context.strokeStyle = paint.strokeColor;
    context.lineWidth = paint.strokeWidth;
    context.setLineDash([]);
    context.stroke(stroke);
  }
}

/**
 * 按图层从下到上画一张瓦片，返回画了多少个要素（0 时画布是空的）。
 * 一组图层按"各图层求出的样式组合"分桶，路径建一次；画的时候严格按图层的顺序，一个图层画完所有桶再画下一个
 */
export function paintTile(
  context: Context,
  layers: readonly CompiledLayer[],
  features: readonly TileFeature[],
  zoom: number,
  { size, factor, column, row }: TileFrame,
  patterns: PatternStore
): number {
  const ids = new Map<Paint, number>();
  const idOf = (paint: Paint) => {
    let id = ids.get(paint);
    if (id === undefined) {
      id = ids.size;
      ids.set(paint, id);
    }
    return id;
  };
  let drawn = 0;
  for (const group of groupLayers(layers)) {
    const [head] = group;
    if (!head) {
      continue;
    }
    const buckets = new Map<string, Bucket>();
    for (const feature of features) {
      if (!accepts(head, feature)) {
        continue;
      }
      const span = feature.extent / factor;
      const offsetX = column * span;
      const offsetY = row * span;
      const scale = size / span;
      const margin = CULL_MARGIN / scale;
      const [minX, minY, maxX, maxY] = feature.box;
      if (maxX < offsetX - margin || minX > offsetX + span + margin || maxY < offsetY - margin || minY > offsetY + span + margin) {
        continue;
      }
      if (!head.matches(feature, zoom)) {
        continue;
      }
      const paints = group.map(layer => layer.paintOf(feature, zoom));
      const closed = feature.type === 3;
      const key = `${closed ? 'p' : 'l'}|${paints.map(idOf).join('|')}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { paints, paths: [new Path2D()], strokes: [new Path2D()], closed, count: 0 };
        buckets.set(key, bucket);
      }
      if (bucket.count >= BATCH_SIZE) {
        bucket.paths.push(new Path2D());
        bucket.strokes.push(new Path2D());
        bucket.count = 0;
      }
      const [first] = paints;
      const path = bucket.paths.at(-1);
      if (first?.type === 'circle') {
        appendCircles(bucket, first, feature, scale, offsetX, offsetY);
      } else if (path) {
        appendRings(path, feature, scale, offsetX, offsetY);
      }
      bucket.count++;
      drawn++;
    }
    for (const index of group.keys()) {
      for (const bucket of buckets.values()) {
        const paint = bucket.paints[index];
        for (const [position, path] of bucket.paths.entries()) {
          if (paint?.type === 'fill') {
            paintFill(context, paint, path, patterns);
          } else if (paint?.type === 'line') {
            paintLine(context, paint, path, bucket.closed);
          } else if (paint) {
            paintCircle(context, paint, path, bucket.strokes[position]);
          }
        }
      }
    }
    context.globalAlpha = 1;
  }
  return drawn;
}
