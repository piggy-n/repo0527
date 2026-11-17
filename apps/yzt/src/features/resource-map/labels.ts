import type { ExpressionSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup } from '@mx/map-core';
import { MAP_FONT_STACKS } from '@/shared/map/map-fonts';
import type { Resource, ResourceGeometry } from './catalog';
import { labelFieldsOf } from './label-fields';
import { type PointShape, shapeReach } from './point-shapes';
import { normalizeColor, sdfOpacity, sizeStops, type SymbolSize } from './symbols';

// 资源的标注（ADR 0160）：取值、默认值、覆盖的整理和标注图层的推导，都是纯函数。
// 样式存在符号覆盖里（resource-symbols 的 label），显隐是资源的显示状态（resource-layers 的 labeled）

/** 资源标注的分组：在 selection 和 region-clip 之间，三维里画在模型上面，区划外被遮罩盖住 */
export const RESOURCE_LABELS_GROUP = 'resource-labels';

/** 查询详情里那个要素的加强标注，紧挨着压在资源的标注上面 */
export const SELECTION_LABELS_GROUP = 'selection-labels';

/** 字体只有页面已经加载的普惠体两个字重（用户 2026-11-16），不下载字体或字形，写法见 MAP_FONT_STACKS（ADR 0160） */
export const LABEL_FONTS = {
  regular: { name: '普惠体 常规', stack: MAP_FONT_STACKS.regular },
  semibold: { name: '普惠体 中粗', stack: MAP_FONT_STACKS.semibold }
} as const satisfies Readonly<Record<string, { readonly name: string; readonly stack: readonly string[] }>>;

export type LabelFont = keyof typeof LABEL_FONTS;

/** 存进偏好的是键，以后只能增加，不能改名或删除（同点的形状，ADR 0159） */
export const LABEL_FONT_NAMES = Object.keys(LABEL_FONTS) as [LabelFont, ...LabelFont[]];

/** 字号（像素），只用双数 */
export const LABEL_SIZES = [10, 12, 14, 16, 18, 20] as const;

export type LabelSize = (typeof LABEL_SIZES)[number];

/** 描边宽度（像素） */
export const LABEL_HALO_WIDTHS = [0, 1, 1.5, 2, 3] as const;

export type LabelHaloWidth = (typeof LABEL_HALO_WIDTHS)[number];

/** 放置方式和编辑器里的名称；存进偏好的是键，以后只能增加，不能改名或删除 */
export const LABEL_PLACEMENTS = {
  auto: '自动',
  right: '右侧',
  top: '上方',
  line: '沿线',
  horizontal: '水平',
  center: '中心'
} as const;

export type LabelPlacement = keyof typeof LABEL_PLACEMENTS;

export const LABEL_PLACEMENT_NAMES = Object.keys(LABEL_PLACEMENTS) as [LabelPlacement, ...LabelPlacement[]];

/** 各种几何能用的放置方式，按编辑器里的先后 */
export const PLACEMENTS_OF: Readonly<Record<ResourceGeometry, readonly LabelPlacement[]>> = {
  circle: ['auto', 'right', 'top'],
  line: ['line', 'horizontal'],
  fill: ['center']
};

/** 默认的放置方式：点默认"上方"（用户 2026-11-16） */
const DEFAULT_PLACEMENTS: Readonly<Record<ResourceGeometry, LabelPlacement>> = {
  circle: 'top',
  line: 'line',
  fill: 'center'
};

/** 显示级别的范围：滑块的两头，最大级别拉到头时不限制（三维最大 20 级） */
export const LABEL_ZOOM_RANGE = { min: 8, max: 20 } as const;

/** 默认从 15 级起显示（用户 2026-11-16） */
const DEFAULT_MINZOOM = 15;

/** 一个资源的标注 */
export interface ResourceLabel {
  /** 标注的属性，取 label-fields.ts 登记的 */
  readonly field: string;
  readonly font: LabelFont;
  readonly size: LabelSize;
  readonly color: string;
  readonly haloColor: string;
  readonly haloWidth: LabelHaloWidth;
  readonly placement: LabelPlacement;
  /** 显示级别，整数，含两头 */
  readonly minzoom: number;
  readonly maxzoom: number;
  /** 压盖：文字之间允许重叠 */
  readonly overlap: boolean;
}

/** 标注的覆盖：只记和默认不同的字段 */
export type LabelOverride = Partial<ResourceLabel>;

export type LabelField = keyof ResourceLabel;

/** 取色器能拖动预览的两个颜色 */
export const LABEL_COLOR_FIELDS = ['color', 'haloColor'] as const;

export type LabelColorField = (typeof LABEL_COLOR_FIELDS)[number];

// 文字的默认颜色按几何：面上的地类名称最深，点、线的稍浅；水系是深蓝、中粗（旧项目的水域线层）
const DEFAULT_COLORS: Readonly<Record<ResourceGeometry, string>> = {
  fill: '#1F2937',
  line: '#4B5563',
  circle: '#374151'
};

const WATER_LABEL: Partial<Pick<ResourceLabel, 'color' | 'font'>> = { color: '#0B4A78', font: 'semibold' };

// 个别资源和通用默认不同的地方
type LabelTuning = Partial<Pick<ResourceLabel, 'color' | 'font'>>;

const LABEL_TUNING: ReadonlyMap<string, LabelTuning> = new Map<string, LabelTuning>([
  ['csxhjctb_hydl', WATER_LABEL],
  ['csxhjctb_hyda', WATER_LABEL],
  ['szy_hl_fs', WATER_LABEL],
  ['szy_hl_ks', WATER_LABEL],
  ['szy_hp_fs', WATER_LABEL],
  ['szy_hp_ks', WATER_LABEL],
  ['szy_sk_fs', WATER_LABEL],
  ['szy_sk_ks', WATER_LABEL]
]);

/** 代码给出的默认标注：登记的第一个字段，12 号、白色 1.5 像素描边，15 级起；没有登记字段的资源为 null */
export function codeDefaultLabel(resource: Resource): ResourceLabel | null {
  const [first] = labelFieldsOf(resource.code);
  if (!first) {
    return null;
  }
  return {
    field: first.field,
    font: 'regular',
    size: 12,
    color: DEFAULT_COLORS[resource.geometry],
    haloColor: '#FFFFFF',
    haloWidth: 1.5,
    placement: DEFAULT_PLACEMENTS[resource.geometry],
    minzoom: DEFAULT_MINZOOM,
    maxzoom: LABEL_ZOOM_RANGE.max,
    overlap: false,
    ...LABEL_TUNING.get(resource.code)
  };
}

/**
 * 默认标注叠加覆盖；覆盖来自偏好或发布的默认，不认识的字段（登记改了）、这种几何用不了的放置方式用默认的，
 * 级别反了时最大级别跟着最小级别
 */
export function resolveLabel(
  resource: Resource,
  defaults: ResourceLabel,
  override: LabelOverride | undefined
): ResourceLabel {
  const merged = { ...defaults, ...override };
  const field = labelFieldsOf(resource.code).some(option => option.field === merged.field)
    ? merged.field
    : defaults.field;
  const placement = PLACEMENTS_OF[resource.geometry].includes(merged.placement) ? merged.placement : defaults.placement;
  return { ...merged, field, placement, maxzoom: Math.max(merged.minzoom, merged.maxzoom) };
}

/** 标注字段的固定顺序：整理覆盖、写发布默认的文件都按它 */
export const LABEL_KEYS: readonly LabelField[] = [
  'field',
  'font',
  'size',
  'color',
  'haloColor',
  'haloWidth',
  'placement',
  'minzoom',
  'maxzoom',
  'overlap'
];

// 留下有值、keep 认可的字段
function pickLabel(label: LabelOverride, keep: (key: LabelField) => boolean): LabelOverride {
  const has = (key: LabelField) => label[key] !== undefined && keep(key);
  const { field, font, size, color, haloColor, haloWidth, placement, minzoom, maxzoom, overlap } = label;
  return {
    ...(has('field') ? { field } : {}),
    ...(has('font') ? { font } : {}),
    ...(has('size') ? { size } : {}),
    ...(has('color') ? { color } : {}),
    ...(has('haloColor') ? { haloColor } : {}),
    ...(has('haloWidth') ? { haloWidth } : {}),
    ...(has('placement') ? { placement } : {}),
    ...(has('minzoom') ? { minzoom } : {}),
    ...(has('maxzoom') ? { maxzoom } : {}),
    ...(has('overlap') ? { overlap } : {})
  };
}

/** 去掉值为 undefined 的字段 */
export function compactLabel(label: LabelOverride): LabelOverride {
  return pickLabel(label, () => true);
}

const sameLabelValue = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' ? (normalizeColor(a) ?? a) === (normalizeColor(b) ?? b) : a === b;

/** 覆盖改动后的样子：颜色规范化，和默认相同的字段不记；什么都不剩时是空对象 */
export function nextLabelOverride(
  defaults: ResourceLabel,
  current: LabelOverride | undefined,
  patch: LabelOverride
): LabelOverride {
  const merged: LabelOverride = { ...current, ...patch };
  const next = pickLabel(merged, key => !sameLabelValue(merged[key], defaults[key]));
  const { color, haloColor } = next;
  return {
    ...next,
    ...(color === undefined ? {} : { color: normalizeColor(color) ?? color }),
    ...(haloColor === undefined ? {} : { haloColor: normalizeColor(haloColor) ?? haloColor })
  };
}

/** 后端的占位值：水域线层的名称有三分之二是它（2026-11-01 探查），只过滤、不显示 */
export const LABEL_PLACEHOLDER = '-9999';

/** 标注的文字：字段的值，没有值、是占位值时为空（MapLibre 不画空文字） */
export function labelText(field: string): ExpressionSpecification {
  const value: ExpressionSpecification = ['to-string', ['coalesce', ['get', field], '']];
  return ['case', ['==', value, LABEL_PLACEHOLDER], '', value];
}

/** 点在某一级伸出锚点多远（像素，含描边），文字让开它 */
export interface PointReachStop {
  readonly zoom: number;
  readonly up: number;
  readonly down: number;
  readonly side: number;
}

/** 点图层里的一种符号：形状、大小和描边 */
export interface PointLook {
  readonly shape: PointShape;
  readonly size: SymbolSize;
  readonly strokeWidth: number;
}

/** 点资源用到的符号在各级伸出多远：各类取最大，断点同点的大小曲线 */
export function pointReach(looks: readonly PointLook[]): readonly PointReachStop[] {
  const zooms = sizeStops('circle', 'M').map(([zoom]) => zoom);
  return zooms.map((zoom, index) => {
    const extents = looks.map(({ shape, size, strokeWidth }) => {
      const radius = sizeStops('circle', size)[index]?.[1] ?? 0;
      const reach = shapeReach(shape);
      return {
        up: reach.up * radius + strokeWidth,
        down: reach.down * radius + strokeWidth,
        side: reach.side * radius + strokeWidth
      };
    });
    return {
      zoom,
      up: Math.max(0, ...extents.map(extent => extent.up)),
      down: Math.max(0, ...extents.map(extent => extent.down)),
      side: Math.max(0, ...extents.map(extent => extent.side))
    };
  });
}

/** 推导一个资源的标注图层要用的：数据源、瓦片图层名、几何过滤和级别来自资源，样式来自标注 */
export interface LabelTarget {
  readonly code: string;
  readonly geometry: ResourceGeometry;
  /** 资源分组里的数据源：推导方要保证它此刻在资源分组里 */
  readonly source: string;
  readonly sourceLayer: string;
  readonly filter: ExpressionSpecification;
  /** 资源的最小显示级别：更低的级别没有瓦片 */
  readonly minzoom: number | undefined;
  readonly label: ResourceLabel;
  /** 点资源画出的点伸出多远；不是点资源时为 null */
  readonly reach: readonly PointReachStop[] | null;
  /** 图层的透明度，0～1 */
  readonly opacity: number;
}

// 文字离开点的间隔（像素）
const POINT_GAP = 3;

type SymbolLayout = NonNullable<SymbolLayerSpecification['layout']>;

const literal = (value: unknown): ExpressionSpecification => ['literal', value];

// 点的放置：偏移按级别插值（点的大小随级别变），单位是 em，所以按字号换算
function pointLayout(placement: LabelPlacement, size: number, reach: readonly PointReachStop[]): SymbolLayout {
  const em = (pixels: number) => Number(((pixels + POINT_GAP) / size).toFixed(3));
  const byZoom = (value: (stop: PointReachStop) => unknown): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...reach.flatMap(stop => [stop.zoom, literal(value(stop))])
  ];
  if (placement === 'right') {
    return { 'text-anchor': 'left', 'text-offset': byZoom(stop => [em(stop.side), 0]) };
  }
  if (placement === 'auto') {
    // 先放右边，再左边、上面、下面
    return {
      'text-variable-anchor-offset': byZoom(stop => [
        'left',
        [em(stop.side), 0],
        'right',
        [-em(stop.side), 0],
        'bottom',
        [0, -em(stop.up)],
        'top',
        [0, em(stop.down)]
      ]),
      'text-justify': 'auto'
    };
  }
  return { 'text-anchor': 'bottom', 'text-offset': byZoom(stop => [0, -em(stop.up)]) };
}

// 放置方式对应的 layout；面用默认的 point 放置（每块瓦片里取不可达极点，跨瓦片的大面会重复标）
function placementLayout({ label, geometry, reach }: LabelTarget, size: number): SymbolLayout {
  if (geometry === 'circle') {
    return pointLayout(label.placement, size, reach ?? []);
  }
  if (geometry === 'line') {
    return label.placement === 'horizontal'
      ? { 'symbol-placement': 'line-center', 'text-rotation-alignment': 'viewport' }
      : { 'symbol-placement': 'line', 'symbol-spacing': 260, 'text-max-angle': 35 };
  }
  return {};
}

// 显示级别：不低于资源的最小显示级别；最大级别含这一级，拉到头时不限制
function zoomRange({ label, minzoom }: LabelTarget): Pick<SymbolLayerSpecification, 'minzoom' | 'maxzoom'> {
  const lowest = Math.max(label.minzoom, minzoom ?? 0);
  return label.maxzoom >= LABEL_ZOOM_RANGE.max ? { minzoom: lowest } : { minzoom: lowest, maxzoom: label.maxzoom + 1 };
}

const guidOf: ExpressionSpecification = ['to-string', ['get', 'guid']];

/** 资源的标注图层 ID */
export function resourceLabelLayerId(code: string): string {
  return `${RESOURCE_LABELS_GROUP}-${code}`;
}

/** 标注图层（资源的和加强的）：点到文字时这个要素也是点选的候选，框选的估数不算它们 */
export function isLabelLayer(layerId: string): boolean {
  return layerId.startsWith(`${RESOURCE_LABELS_GROUP}-`) || layerId.startsWith(`${SELECTION_LABELS_GROUP}-`);
}

/**
 * 资源的标注图层：和资源共用数据源，文字的透明度跟着图层（SDF 低于 10% 不画，同点）。
 * hidden 是正在加强标注的要素的 guid，这里滤掉它，和加强标注同一轮提交
 */
export function resourceLabelLayer(target: LabelTarget, hidden: string | null = null): SymbolLayerSpecification {
  const { label } = target;
  const filter: ExpressionSpecification =
    hidden === null ? target.filter : ['all', target.filter, ['!=', guidOf, hidden]];
  return {
    id: resourceLabelLayerId(target.code),
    type: 'symbol',
    source: target.source,
    'source-layer': target.sourceLayer,
    ...zoomRange(target),
    filter,
    layout: {
      'text-field': labelText(label.field),
      'text-font': [...LABEL_FONTS[label.font].stack],
      'text-size': label.size,
      'text-max-width': 10,
      'text-padding': 2,
      'text-allow-overlap': label.overlap,
      ...placementLayout(target, label.size)
    },
    paint: {
      'text-color': label.color,
      'text-halo-color': label.haloColor,
      'text-halo-width': label.haloWidth,
      'text-halo-blur': label.haloWidth > 0 ? 0.5 : 0,
      'text-opacity': sdfOpacity(target.opacity)
    }
  };
}

// 加强标注：中粗、大 2 号、选中高亮的红色加白色描边，不参与避让（用户 2026-11-16）
const EMPHASIS_COLOR = '#f5222d';
const EMPHASIS_HALO = 2;
const EMPHASIS_SIZE_STEP = 2;

/**
 * 查询详情里正在看的要素的加强标注（ADR 0160）：和资源的标注同样的字段、放置和级别，压在所有标注上面、始终显示，
 * 文字不跟着图层的透明度；不加倾斜（普惠体没有斜体）
 */
export function emphasisLabelLayer(target: LabelTarget, guid: string): SymbolLayerSpecification {
  const { label } = target;
  const size = label.size + EMPHASIS_SIZE_STEP;
  return {
    id: `${SELECTION_LABELS_GROUP}-${target.code}`,
    type: 'symbol',
    source: target.source,
    'source-layer': target.sourceLayer,
    ...zoomRange(target),
    filter: ['all', target.filter, ['==', guidOf, guid]],
    layout: {
      'text-field': labelText(label.field),
      'text-font': [...LABEL_FONTS.semibold.stack],
      'text-size': size,
      'text-max-width': 10,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      ...placementLayout(target, size)
    },
    paint: {
      'text-color': EMPHASIS_COLOR,
      'text-halo-color': '#FFFFFF',
      'text-halo-width': EMPHASIS_HALO,
      'text-halo-blur': 0.5
    }
  };
}

// 碰撞时上面的图层先放：从下到上是面、线、点（点 > 线 > 面），同一种几何按面板的先后
const GEOMETRY_ORDER: readonly ResourceGeometry[] = ['fill', 'line', 'circle'];

/** 正在加强标注的要素：资源和 guid */
export interface LabelEmphasis {
  readonly code: string;
  readonly guid: string;
}

/**
 * resource-labels 分组：targets 是开着标注的资源，按面板从上到下；emphasis 所在资源的标注滤掉这个要素。
 * 只引用资源分组的数据源，没有自己的数据源
 */
export function labelsGroupOf(targets: readonly LabelTarget[], emphasis: LabelEmphasis | null): StyleGroup {
  const bottomUp = targets.toReversed();
  const layers = GEOMETRY_ORDER.flatMap(geometry =>
    bottomUp
      .filter(target => target.geometry === geometry)
      .map(target => resourceLabelLayer(target, emphasis?.code === target.code ? emphasis.guid : null))
  );
  return { sources: {}, layers };
}

/** selection-labels 分组：加强标注一个要素；没有时是空分组 */
export function selectionLabelsGroup(target: LabelTarget | null, guid: string | null): StyleGroup {
  return { sources: {}, layers: target && guid !== null ? [emphasisLabelLayer(target, guid)] : [] };
}
