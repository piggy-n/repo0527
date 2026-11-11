import {
  Color,
  expression,
  featureFilter,
  type FeatureFilter,
  Formatted,
  latest,
  type PropertyValueSpecification,
  ResolvedImage,
  type StylePropertyExpression,
  type StylePropertySpecification,
  type SymbolLayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { LabelPaint, VectorLayerSpecification } from './mvt-protocol';
import type { TileFeature } from './tile-geometry';

// 方案 B 的 PoC：把二维的图层定义编译成画布上的样式。表达式和过滤条件一律交给 style-spec 求值（ADR 0024），
// 旧项目手写的求值器（styleExpression.js，347 行）不再移植

export interface FillPaint {
  readonly type: 'fill';
  /** CSS 颜色；透明时为 null */
  readonly color: string | null;
  readonly opacity: number;
  /** 填充是否完全不透明：相邻图斑之间的细缝只在这时补 */
  readonly opaque: boolean;
  /** 描边的 CSS 颜色；'fill' 是没写、跟填充色，'none' 是不画（写了透明色，或关了 fill-antialias） */
  readonly outline: string;
  /** 花纹图片的 ID */
  readonly pattern: string | null;
}

export interface LinePaint {
  readonly type: 'line';
  readonly color: string | null;
  readonly opacity: number;
  readonly width: number;
  /** 线宽的倍数，同 MapLibre */
  readonly dash: readonly number[] | null;
  readonly offset: number;
  readonly cap: CanvasLineCap;
  readonly join: CanvasLineJoin;
}

export interface CirclePaint {
  readonly type: 'circle';
  readonly color: string | null;
  readonly opacity: number;
  readonly radius: number;
  readonly strokeColor: string | null;
  readonly strokeWidth: number;
  readonly strokeOpacity: number;
}

export type Paint = FillPaint | LinePaint | CirclePaint;

type Specs = Readonly<Record<string, object>>;

const PAINT_SPECS: Readonly<Record<VectorLayerSpecification['type'], Specs>> = {
  fill: latest.paint_fill,
  line: latest.paint_line,
  circle: latest.paint_circle
};

const LAYOUT_SPECS: Readonly<Record<VectorLayerSpecification['type'], Specs>> = {
  fill: latest.layout_fill,
  line: latest.layout_line,
  circle: latest.layout_circle
};

const USED_PAINT: Readonly<Record<VectorLayerSpecification['type'], readonly string[]>> = {
  fill: ['fill-color', 'fill-opacity', 'fill-outline-color', 'fill-antialias', 'fill-pattern'],
  line: ['line-color', 'line-opacity', 'line-width', 'line-dasharray', 'line-offset'],
  circle: [
    'circle-color',
    'circle-opacity',
    'circle-radius',
    'circle-stroke-color',
    'circle-stroke-width',
    'circle-stroke-opacity'
  ]
};

const USED_LAYOUT: Readonly<Record<VectorLayerSpecification['type'], readonly string[]>> = {
  fill: [],
  line: ['line-cap', 'line-join'],
  circle: []
};

type Expressions = Map<string, StylePropertyExpression>;

function compileProperties(
  rootKey: string,
  names: readonly string[],
  specs: Specs,
  values: Readonly<Record<string, unknown>>,
  into: Expressions
): void {
  for (const name of names) {
    // latest 的类型由规范的 JSON 推断，字段是宽的 string，和 StylePropertySpecification 对不上（同 overlay-plan）
    const specification = specs[name] as StylePropertySpecification | undefined;
    const value = name in values ? values[name] : specification?.default;
    if (!specification || value === undefined) {
      continue;
    }
    try {
      const input = value as PropertyValueSpecification<unknown>;
      into.set(name, expression.normalizePropertyExpression(input, `${rootKey}.${name}`, specification));
    } catch {
      // 写错的属性按没写处理，不影响其他属性和图层
    }
  }
}

/**
 * 一个值里读到的要素属性；讲不清时返回 false（按要素属性取值的旧式函数以外的对象、动态的属性名、整个属性表）。
 * 宁可多收：多收只是多留几个属性、缓存分得细一点，漏收会把字段从瓦片里裁掉
 */
export function collectProperties(value: unknown, into: Set<string>): boolean {
  if (Array.isArray(value)) {
    const [operator, first] = value as readonly unknown[];
    if (operator === 'literal') {
      return true;
    }
    if (operator === 'properties') {
      return false;
    }
    if ((operator === 'get' || operator === 'has') && value.length === 2) {
      if (typeof first !== 'string') {
        return false;
      }
      into.add(first);
      return true;
    }
    return value.every(item => collectProperties(item, into));
  }
  if (typeof value === 'object' && value !== null) {
    // 旧式函数：{ property, stops }
    const { property } = value as { property?: unknown };
    if (typeof property === 'string') {
      into.add(property);
    }
    return true;
  }
  return true;
}

// 旧式过滤（['==', 'key', value]）的字段名不在 get 里，认不出来就按讲不清处理
function filterProperties(filter: unknown, into: Set<string>): boolean {
  if (filter === undefined || filter === null) {
    return true;
  }
  return expression.isExpressionFilter(filter) && collectProperties(filter, into);
}

function cssOf(color: unknown): string | null {
  if (!(color instanceof Color) || color.a === 0) {
    return null;
  }
  const [r, g, b, a] = color.rgb;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const CAPS: ReadonlySet<unknown> = new Set<CanvasLineCap>(['butt', 'round', 'square']);
const JOINS: ReadonlySet<unknown> = new Set<CanvasLineJoin>(['bevel', 'round', 'miter']);
const isCap = (value: unknown): value is CanvasLineCap => CAPS.has(value);
const isJoin = (value: unknown): value is CanvasLineJoin => JOINS.has(value);

// 求值结果里的文字：字符串、数字原样，Formatted（text-field）、ResolvedImage（fill-pattern）取它们的文字
function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Formatted) {
    return value.toString();
  }
  return value instanceof ResolvedImage ? value.name : '';
}

/** 一个图层编译后的结果：按"缩放级 + 用到的属性值"记住求值结果，十万个要素也只求值几十次 */
export class CompiledLayer {
  readonly id: string;
  readonly type: VectorLayerSpecification['type'];
  readonly sourceLayer: string | undefined;
  readonly minzoom: number;
  readonly maxzoom: number;
  readonly visible: boolean;
  /** 吃同一批要素的相邻图层共用一份路径：数据源图层和过滤条件都相同 */
  readonly groupKey: string;
  /** 样式和过滤读到的属性；讲不清时为 null，解码时属性全留 */
  readonly accessed: ReadonlySet<string> | null;
  readonly #filter: FeatureFilter;
  readonly #paint: Expressions = new Map();
  readonly #layout: Expressions = new Map();
  readonly #hasOutline: boolean;
  // 样式读到的属性：求值结果按它们的值记住；讲不清时每个要素都求值
  readonly #keys: readonly string[] | null;
  readonly #byValue = new Map<string, Paint>();
  // 内容相同的样式是同一个对象：分桶按对象身份
  readonly #byContent = new Map<string, Paint>();

  constructor(layer: VectorLayerSpecification) {
    this.id = layer.id;
    this.type = layer.type;
    this.sourceLayer = layer['source-layer'];
    this.minzoom = layer.minzoom ?? 0;
    this.maxzoom = layer.maxzoom ?? 24;
    this.visible = layer.layout?.visibility !== 'none';
    this.groupKey = `${layer['source-layer'] ?? ''}|${JSON.stringify(layer.filter ?? null)}`;
    this.#filter = featureFilter(layer.filter, `${layer.id}.filter`);
    const paint: Readonly<Record<string, unknown>> = layer.paint ?? {};
    const layout: Readonly<Record<string, unknown>> = layer.layout ?? {};
    compileProperties(layer.id, USED_PAINT[layer.type], PAINT_SPECS[layer.type], paint, this.#paint);
    compileProperties(layer.id, USED_LAYOUT[layer.type], LAYOUT_SPECS[layer.type], layout, this.#layout);
    this.#hasOutline = 'fill-outline-color' in paint;
    const keys = new Set<string>();
    const known = [...Object.values(paint), ...Object.values(layout)].every(value => collectProperties(value, keys));
    this.#keys = known ? [...keys] : null;
    const accessed = new Set(keys);
    this.accessed = known && filterProperties(layer.filter, accessed) ? accessed : null;
  }

  /** 这一级画不画：和二维一样是 [minzoom, maxzoom) */
  activeAt(zoom: number): boolean {
    return this.visible && zoom >= this.minzoom && zoom < this.maxzoom;
  }

  matches(feature: TileFeature, zoom: number): boolean {
    return (this.sourceLayer === undefined || feature.sourceLayer === this.sourceLayer) && this.#filter.filter({ zoom }, feature);
  }

  paintOf(feature: TileFeature, zoom: number): Paint {
    const keys = this.#keys;
    const valueKey = keys ? `${zoom}|${feature.type}|${keys.map(key => String(feature.properties[key])).join('\u0001')}` : null;
    const remembered = valueKey === null ? undefined : this.#byValue.get(valueKey);
    if (remembered) {
      return remembered;
    }
    const evaluated = this.#evaluate(feature, zoom);
    const contentKey = JSON.stringify(evaluated);
    const paint = this.#byContent.get(contentKey) ?? evaluated;
    this.#byContent.set(contentKey, paint);
    if (valueKey !== null) {
      this.#byValue.set(valueKey, paint);
    }
    return paint;
  }

  #evaluate(feature: TileFeature, zoom: number): Paint {
    const read = (from: Expressions, name: string): unknown => {
      try {
        const value: unknown = from.get(name)?.evaluate({ zoom }, feature);
        return value;
      } catch {
        return undefined;
      }
    };
    const paint = (name: string) => read(this.#paint, name);
    if (this.type === 'fill') {
      const color = cssOf(paint('fill-color'));
      const fill = paint('fill-color');
      const opacity = numberOr(paint('fill-opacity'), 1);
      const pattern = paint('fill-pattern');
      const antialias = paint('fill-antialias') !== false;
      const outline = cssOf(paint('fill-outline-color'));
      return {
        type: 'fill',
        color,
        opacity,
        opaque: fill instanceof Color && fill.a * opacity >= 0.999,
        outline: !antialias || (this.#hasOutline && outline === null) ? 'none' : (outline ?? 'fill'),
        // 求值结果是 ResolvedImage，名字就是图片的 ID
        pattern: textOf(pattern) || null
      };
    }
    if (this.type === 'line') {
      const dash = paint('line-dasharray');
      const cap = read(this.#layout, 'line-cap');
      const join = read(this.#layout, 'line-join');
      return {
        type: 'line',
        color: cssOf(paint('line-color')),
        opacity: numberOr(paint('line-opacity'), 1),
        width: numberOr(paint('line-width'), 1),
        dash: Array.isArray(dash) && dash.length > 0 ? dash.map(Number) : null,
        offset: numberOr(paint('line-offset'), 0),
        cap: isCap(cap) ? cap : 'butt',
        join: isJoin(join) ? join : 'miter'
      };
    }
    return {
      type: 'circle',
      color: cssOf(paint('circle-color')),
      opacity: numberOr(paint('circle-opacity'), 1),
      radius: numberOr(paint('circle-radius'), 5),
      strokeColor: cssOf(paint('circle-stroke-color')),
      strokeWidth: numberOr(paint('circle-stroke-width'), 0),
      strokeOpacity: numberOr(paint('circle-stroke-opacity'), 1)
    };
  }
}

/** 有文字的 symbol 图层：位图里不画，Worker 只给出文字和锚点，主线程用 Cesium 的标注显示 */
export class CompiledLabelLayer {
  readonly id: string;
  readonly sourceLayer: string | undefined;
  readonly minzoom: number;
  readonly maxzoom: number;
  readonly visible: boolean;
  readonly accessed: ReadonlySet<string> | null;
  readonly #filter: FeatureFilter;
  readonly #layout: Expressions = new Map();
  readonly #paint: Expressions = new Map();

  constructor(layer: SymbolLayerSpecification) {
    this.id = layer.id;
    this.sourceLayer = layer['source-layer'];
    this.minzoom = layer.minzoom ?? 0;
    this.maxzoom = layer.maxzoom ?? 24;
    this.visible = layer.layout?.visibility !== 'none';
    this.#filter = featureFilter(layer.filter, `${layer.id}.filter`);
    const layout: Readonly<Record<string, unknown>> = layer.layout ?? {};
    const paint: Readonly<Record<string, unknown>> = layer.paint ?? {};
    compileProperties(layer.id, ['text-field', 'text-size'], latest.layout_symbol, layout, this.#layout);
    compileProperties(layer.id, ['text-color', 'text-halo-color', 'text-halo-width'], latest.paint_symbol, paint, this.#paint);
    const accessed = new Set<string>();
    const field = layout['text-field'];
    // 旧式的 "{name}" 写法
    const tokens = typeof field === 'string' ? [...field.matchAll(/\{([^}]+)\}/g)].map(match => match[1] ?? '') : [];
    tokens.forEach(token => accessed.add(token));
    const known = collectProperties(field, accessed) && filterProperties(layer.filter, accessed);
    this.accessed = known ? accessed : null;
  }

  activeAt(zoom: number): boolean {
    return this.visible && zoom >= this.minzoom && zoom < this.maxzoom;
  }

  /** 要素的文字；不属于这个图层、没有文字时为空字符串 */
  textOf(feature: TileFeature, zoom: number): string {
    if (this.sourceLayer !== undefined && feature.sourceLayer !== this.sourceLayer) {
      return '';
    }
    if (!this.#filter.filter({ zoom }, feature)) {
      return '';
    }
    try {
      const value: unknown = this.#layout.get('text-field')?.evaluate({ zoom }, feature);
      return textOf(value);
    } catch {
      return '';
    }
  }

  paintAt(zoom: number): LabelPaint {
    const read = (from: Expressions, name: string): unknown => {
      try {
        const value: unknown = from.get(name)?.evaluate({ zoom });
        return value;
      } catch {
        return undefined;
      }
    };
    return {
      size: numberOr(read(this.#layout, 'text-size'), 16),
      color: cssOf(read(this.#paint, 'text-color')) ?? 'rgba(0,0,0,1)',
      haloColor: cssOf(read(this.#paint, 'text-halo-color')) ?? 'rgba(0,0,0,0)',
      haloWidth: numberOr(read(this.#paint, 'text-halo-width'), 0)
    };
  }
}
