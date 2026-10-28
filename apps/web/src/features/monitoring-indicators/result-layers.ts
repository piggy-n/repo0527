import {
  Color,
  type ExpressionSpecification,
  type LayerSpecification,
  type SourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup, StyleImage } from '@yzt/map-core';

/** 成果子图层的几何类型 */
export type ResultGeometry = 'point' | 'line' | 'fill';

/** 指标成果的一个子图层（接口的一个 gdb 图层） */
export interface ResultLayer {
  /** 图层名（gdbName），瓦片地址和 source-layer 都用它 */
  readonly key: string;
  readonly name: string;
  readonly geometry: ResultGeometry;
  /** 默认颜色 */
  readonly color: string;
  /** 区划范围（城区范围面、城市范围面）：垫在最下面 */
  readonly range: boolean;
}

/** 一个指标的成果 */
export interface IndicatorResult {
  /** 瓦片地址里的分析 ID */
  readonly analysisId: string;
  /** 计算结果，如"40.04%" */
  readonly value: string;
  /** 按面板上的顺序：点、线、面、区划范围；地图上从下到上反过来叠 */
  readonly layers: readonly ResultLayer[];
}

/** 接口给出的子图层，api.ts 解析后交给 resultLayersOf */
export interface ResultLayerSource {
  readonly key: string;
  readonly name: string;
  readonly geometry: ResultGeometry;
}

/** 图层与图例的默认色板，颜色沿用旧页面 */
const LAYER_COLORS = ['#597EF7', '#59C0F7', '#10B981', '#F2B84B', '#7C8CC4', '#76B7A3', '#8B9DB5', '#C9A96E'];

/** 多个点图层时用圆点，按出现的顺序取不同的颜色 */
const POINT_COLORS = [
  '#3D6FB4',
  '#C9823E',
  '#4E8C73',
  '#8E6FA6',
  '#B08A4F',
  '#5B7A9D',
  '#6E8F5E',
  '#A86A5C',
  '#7C8CC4',
  '#5F8C8C',
  '#9C8459',
  '#7A9070'
];

/** 区划范围的默认色 */
export const RANGE_COLOR = '#EDF4BE';

// 线和面按名称里的关键字取色（旧页面为设施覆盖类指标配的颜色），都不符合时按序号取色板
const NAMED_COLORS: readonly (readonly [string, string])[] = [
  ['路网', '#90966F'],
  ['已覆盖', '#FAB100'],
  ['未覆盖', '#AFEFB4'],
  ['覆盖范围', '#99D8EA'],
  ['城区', RANGE_COLOR],
  ['区域范围', RANGE_COLOR]
];

/** 区划范围的图层：名称是"城区范围面"（cqjcfwa）或"城市范围面"（xzq） */
export function isRangeLayer({ name }: ResultLayerSource): boolean {
  return name.endsWith('范围面');
}

const DISPLAY_ORDER: Readonly<Record<ResultGeometry, number>> = { point: 0, line: 1, fill: 2 };

/** 给接口的子图层配上默认色，按点、线、面、区划范围排好 */
export function resultLayersOf(sources: readonly ResultLayerSource[]): ResultLayer[] {
  let points = 0;
  const layers = sources.map((source, index): ResultLayer => {
    const range = isRangeLayer(source);
    const named = NAMED_COLORS.find(([keyword]) => source.name.includes(keyword))?.[1];
    let color: string;
    if (range) {
      color = RANGE_COLOR;
    } else if (source.geometry === 'point') {
      color = POINT_COLORS[points % POINT_COLORS.length] ?? RANGE_COLOR;
      points++;
    } else {
      color = named ?? LAYER_COLORS[index % LAYER_COLORS.length] ?? RANGE_COLOR;
    }
    return { ...source, color, range };
  });
  const weight = (layer: ResultLayer) => (layer.range ? 3 : DISPLAY_ORDER[layer.geometry]);
  return layers.toSorted((a, b) => weight(a) - weight(b));
}

/** 两个颜色是否相同：取色器给出 rgb()，默认色是 #RRGGBB，写法不同也算同一个；解析不了的不相同 */
export function sameColor(a: string, b: string): boolean {
  const first = Color.parse(a)?.rgb;
  const second = Color.parse(b)?.rgb;
  return (
    first !== undefined &&
    second !== undefined &&
    first.every((value, index) => Math.round(value * 255) === Math.round((second[index] ?? Number.NaN) * 255))
  );
}

/** 点的画法：只有一个点图层时用旗子（不能改色），多个时用不同颜色的圆点区分 */
export type PointSymbol = 'flag' | 'circle';

export function pointSymbolOf(layers: readonly ResultLayer[]): PointSymbol {
  return layers.filter(layer => layer.geometry === 'point').length <= 1 ? 'flag' : 'circle';
}

/** 图层能不能改色：旗子不能 */
export function isRecolorable(layer: ResultLayer, symbol: PointSymbol): boolean {
  return layer.geometry !== 'point' || symbol === 'circle';
}

/** 成果的分组名，数据源、图层、图片的 ID 都以它开头 */
export const RESULT_GROUP = 'indicator-result';

const FLAG_IMAGE_ID = `${RESULT_GROUP}-flag`;

/** 瓦片的基础地址：MapLibre 在 Worker 里请求瓦片，要绝对地址；后面直接拼分析 ID、图层名和 {z}/{x}/{y} */
export function resultTileBase(apiBaseUrl: string, origin: string): string {
  return new URL(`${apiBaseUrl}/api/analysis/mvt/`, origin).href;
}

// 后端的瓦片最高到 14 级，更高时放大显示
const SOURCE_MAXZOOM = 14;

const GEOMETRY_FILTERS: Readonly<Record<ResultGeometry, ExpressionSpecification>> = {
  fill: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
  line: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
  point: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
};

// 线宽、点的大小随级别变化，取值沿用旧页面
const LINE_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 6, 0.3, 10, 0.7, 13, 1.4, 16, 2.6, 18, 3.5];
const CIRCLE_RADIUS: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 4, 14, 6, 18, 9];
const CIRCLE_STROKE_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 6, 0.4, 10, 1, 14, 1.5];
const FLAG_SIZE: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 6, 0.28, 10, 0.42, 14, 1.2, 18, 1.7];

/** 要显示的成果：哪个指标、哪些子图层隐藏了、改了什么颜色 */
export interface ResultDisplay {
  readonly result: IndicatorResult;
  readonly hidden: ReadonlySet<string>;
  /** 子图层的当前颜色（包括正在预览的），没有的用默认色 */
  readonly colors: ReadonlyMap<string, string>;
}

function layersOf(
  layer: ResultLayer,
  symbol: PointSymbol,
  color: string,
  visible: boolean
): LayerSpecification[] {
  const id = `${RESULT_GROUP}-${layer.key}`;
  const common = { source: id, 'source-layer': layer.key, filter: GEOMETRY_FILTERS[layer.geometry] };
  const visibility = visible ? 'visible' : 'none';
  if (layer.geometry === 'point') {
    if (symbol === 'flag') {
      return [
        {
          id,
          type: 'symbol',
          ...common,
          layout: { visibility, 'icon-image': FLAG_IMAGE_ID, 'icon-size': FLAG_SIZE, 'icon-anchor': 'bottom' }
        }
      ];
    }
    return [
      {
        id,
        type: 'circle',
        ...common,
        layout: { visibility },
        paint: {
          'circle-color': color,
          'circle-radius': CIRCLE_RADIUS,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': CIRCLE_STROKE_WIDTH
        }
      }
    ];
  }
  const lineLayout = { visibility, 'line-cap': 'round', 'line-join': 'round' } as const;
  if (layer.geometry === 'line') {
    return [{ id, type: 'line', ...common, layout: lineLayout, paint: { 'line-color': color, 'line-width': LINE_WIDTH } }];
  }
  // 面加一圈同色的边线，相邻的面能分清
  return [
    { id, type: 'fill', ...common, layout: { visibility }, paint: { 'fill-color': color, 'fill-outline-color': color } },
    { id: `${id}-outline`, type: 'line', ...common, layout: lineLayout, paint: { 'line-color': color, 'line-width': 1 } }
  ];
}

/** 推导成果分组：没有要显示的成果时是空分组；地图上从下到上是区划范围、面、线、点 */
export function indicatorResultGroup(display: ResultDisplay | null, tileBase: string): StyleGroup {
  if (display === null) {
    return { sources: {}, layers: [] };
  }
  const { result, hidden, colors } = display;
  const symbol = pointSymbolOf(result.layers);
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  for (const layer of result.layers.toReversed()) {
    const id = `${RESULT_GROUP}-${layer.key}`;
    const path = `${encodeURIComponent(result.analysisId)}/${encodeURIComponent(layer.key)}`;
    sources[id] = { type: 'vector', tiles: [`${tileBase}${path}/{z}/{x}/{y}.pbf`], maxzoom: SOURCE_MAXZOOM };
    layers.push(...layersOf(layer, symbol, colors.get(layer.key) ?? layer.color, !hidden.has(layer.key)));
  }
  const flag = symbol === 'flag' && result.layers.some(layer => layer.geometry === 'point');
  return flag ? { sources, layers, images: { [FLAG_IMAGE_ID]: flagImage() } } : { sources, layers };
}

// 旗子：48 × 48、像素比 2，旗杆在左、旗面向右，锚点在底边中间
const FLAG_PIXELS = 48;
const FLAG_COLOR = [47, 47, 47] as const;

/** 旗子的颜色，图例里画同样的旗子 */
export const FLAG_SYMBOL_COLOR = `rgb(${FLAG_COLOR.join(', ')})`;

// 一个像素点是否在旗子里（以像素为单位的坐标）
function insideFlag(x: number, y: number): boolean {
  const pole = x >= 21 && x <= 25 && y >= 6 && y <= 44;
  // 旗面是三角形：从旗杆上段 (25, 6)～(25, 28) 收到 (42, 17)
  const flag = x >= 25 && x <= 42 && Math.abs(y - 17) <= ((42 - x) / 17) * 11;
  return pole || flag;
}

// 每个像素 4 × 4 采样求覆盖率，边缘平滑
function drawFlag(): StyleImage {
  const data = new Uint8Array(FLAG_PIXELS * FLAG_PIXELS * 4);
  for (let row = 0; row < FLAG_PIXELS; row++) {
    for (let column = 0; column < FLAG_PIXELS; column++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          if (insideFlag(column + (sx + 0.5) / 4, row + (sy + 0.5) / 4)) {
            hits++;
          }
        }
      }
      const offset = (row * FLAG_PIXELS + column) * 4;
      data.set([...FLAG_COLOR, Math.round((hits / 16) * 255)], offset);
    }
  }
  return { width: FLAG_PIXELS, height: FLAG_PIXELS, data, pixelRatio: 2 };
}

// 第一次用到时才画（地图页分块的模块不在顶层计算，ADR 0061）；图片不可变，之后一直用同一个对象
let flag: StyleImage | undefined;

function flagImage(): StyleImage {
  flag ??= drawFlag();
  return flag;
}
