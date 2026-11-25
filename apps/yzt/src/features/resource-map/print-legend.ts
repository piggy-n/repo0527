import { bbox } from '@turf/bbox';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Polygon } from 'geojson';
import type { RenderedFeature, ScreenBox, ToolView } from '@mx/map-core';
import { screenBoxPolygon } from '@mx/map-tools';
import type { PrintLegendBlock, PrintLegendRow } from '@/shared/map/print/print-legend';
import { clipToScope, intersectsScope, type RegionScope } from '@/shared/map/region/region-scope';
import { type PickResource, pickResources } from './feature-query';
import { landuseItemLabel, landuseLegendItems, legendEntry, type LegendSwatch } from './legend';
import { drawLegendSwatch } from './legend-canvas';
import type { ResourceLayersState } from './resource-layers';
import type { SymbolOverrideOf } from './resource-symbols';
import { classKeyOf } from './style-registry';

// 导出图片的资源图例（ADR 0174）：只列画面里画出来的资源，按属性配色的只列画面里出现的取值（用户 2026-11-24，
// ADR 0043 第 3 节留下的按需统计）；整屏查一次渲染要素，按图层同一个 match 求出取值

/** 参与打印的资源：画在地图上、当前级别显示、没被校验拦下、看得见（透明度大于 0）的，从上到下 */
export function printedResources(
  state: ResourceLayersState,
  invalid: ReadonlyMap<string, unknown>,
  zoom: number
): PickResource[] {
  return pickResources(state, invalid, zoom).filter(
    ({ resource }) => (state.displays.get(resource.code)?.opacity ?? 0) > 0
  );
}

/** 画面里画出来的资源和取值：键是资源的 code，值是画出的要素的取值键；统一符号的资源是空集合，没画出要素的资源不在里面 */
export type RenderedClasses = ReadonlyMap<string, ReadonlySet<string>>;

export interface PrintLegendInput {
  readonly state: ResourceLayersState;
  readonly invalid: ReadonlyMap<string, unknown>;
  readonly overrideOf: SymbolOverrideOf;
  readonly zoom: number;
}

export interface RenderedClassesInput extends PrintLegendInput {
  readonly view: Pick<ToolView, 'queryRendered' | 'pick'>;
  /** 地图的 CSS 尺寸：整屏查询 */
  readonly size: { readonly width: number; readonly height: number };
  /** 区划裁剪的范围：只算范围里的要素（同点选、框选，ADR 0051）；没有时为 null */
  readonly scope: RegionScope | null;
}

// 外包框的四角，首尾相接
function boxRing([west, south, east, north]: readonly number[]): number[][] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
}

// 要素的外包矩形；都没有几何时为 null
function featureBounds(features: readonly RenderedFeature[]): Polygon | null {
  const geometries = features.flatMap(({ geometry }) => (geometry ? [geometry] : []));
  if (geometries.length === 0) {
    return null;
  }
  return { type: 'Polygon', coordinates: [boxRing(bbox({ type: 'GeometryCollection', geometries }))] };
}

// 区划在画面里的部分（同框选的 planBox），之后每个要素只和画面里的边界求交。画面是四角拾取到的地面；三维里有一角是天空时
// 用查到的要素的外包矩形，要素都在矩形里，结果相同。区划整个在画面里时不裁：精确求交整个区划要近 200 毫秒（南京市界），
// 画面是凸四边形，区划的外包矩形四角都在里面就整个在里面
function scopeInView(
  scope: RegionScope,
  box: ScreenBox,
  view: Pick<ToolView, 'pick'>,
  features: readonly RenderedFeature[]
): RegionScope | null {
  const screen = screenBoxPolygon(box, at => view.pick(at, { ground: true })) ?? featureBounds(features);
  if (!screen) {
    return null;
  }
  const whole = boxRing(bbox(scope)).every(corner => booleanPointInPolygon(corner, screen));
  return whole ? scope : clipToScope(screen, scope);
}

/**
 * 整屏查一次各资源画出来的要素，求出取值。有区划范围时只算范围里的：先把区划裁到画面里，每个要素先求取值，
 * 已经有了的取值不再求交，统一符号的资源找到一个范围里的要素就停
 */
export function renderedClasses({
  view,
  state,
  invalid,
  overrideOf,
  zoom,
  size,
  scope
}: RenderedClassesInput): RenderedClasses {
  const box: ScreenBox = { from: { x: 0, y: 0 }, to: { x: size.width, y: size.height } };
  const queried = printedResources(state, invalid, zoom).map(target => ({
    target,
    features: view.queryRendered(box, { sources: [target.sourceId], withGeometry: scope !== null })
  }));
  const rendered = new Map<string, ReadonlySet<string>>();
  const area = scope && scopeInView(scope, box, view, queried.flatMap(({ features }) => features));
  if (scope && !area) {
    return rendered;
  }
  const inside = ({ geometry }: RenderedFeature) =>
    area === null || (geometry !== undefined && intersectsScope(geometry, area));
  for (const { target, features } of queried) {
    const { resource } = target;
    const keyOf = classKeyOf(resource, zoom, overrideOf(resource.code));
    if (!keyOf) {
      if (features.some(inside)) {
        rendered.set(resource.code, new Set());
      }
      continue;
    }
    const keys = new Set<string>();
    for (const feature of features) {
      const key = keyOf(feature.properties);
      if (!keys.has(key) && inside(feature)) {
        keys.add(key);
      }
    }
    if (keys.size > 0) {
      rendered.set(resource.code, keys);
    }
  }
  return rendered;
}

/** 打印图例里的一个取值 */
export interface PrintItem {
  readonly key: string;
  readonly label: string;
  readonly swatch: LegendSwatch;
}

/**
 * 打印图例里的一个资源：统一符号是一行；按属性配色的是一组，只有画面里出现的取值，次序同右侧图例。不写过滤条件
 * （用户 2026-11-24）：画出来的要素已经按条件过滤，类别只列画面里出现的
 */
export type PrintEntry =
  | {
      readonly kind: 'symbol';
      readonly code: string;
      readonly title: string;
      readonly opacity: number;
      readonly swatch: LegendSwatch;
    }
  | {
      readonly kind: 'classes';
      readonly code: string;
      readonly title: string;
      /** 跨列时下一列开头的标题 */
      readonly continued: string;
      readonly opacity: number;
      readonly items: readonly PrintItem[];
    };

/** 打印图例里的资源（纯数据）：符号同右侧图例的推导（legendEntry），按分类过滤时只有勾着的类别；名称后面带年份 */
export function printEntries(
  { state, invalid, overrideOf, zoom }: PrintLegendInput,
  rendered: RenderedClasses
): PrintEntry[] {
  return printedResources(state, invalid, zoom).flatMap(({ resource, year, filter }): PrintEntry[] => {
    const present = rendered.get(resource.code);
    if (!present) {
      return [];
    }
    const { code, name } = resource;
    const opacity = state.displays.get(code)?.opacity ?? 1;
    const title = `${name}（${year}）`;
    const entry = legendEntry(resource, year, overrideOf(code), filter);
    if (entry.kind === 'symbol' || entry.mode === 'uniform') {
      return [{ kind: 'symbol', code, title, opacity, swatch: entry.swatch }];
    }
    let items: PrintItem[];
    if (entry.kind === 'values') {
      items = entry.values.filter(({ key }) => present.has(key));
    } else {
      const { swatches } = entry;
      items = landuseLegendItems('', new Map([...swatches].filter(([key]) => present.has(key)))).flatMap(item => {
        const swatch = swatches.get(item.key);
        return swatch ? [{ key: item.key, label: landuseItemLabel(item), swatch }] : [];
      });
    }
    if (items.length === 0) {
      return [];
    }
    return [{ kind: 'classes', code, title, continued: `${name}（${year}，续）`, opacity, items }];
  });
}

/** 打印图例里资源的几组（ADR 0174）：符号按图层的透明度变淡，同右侧图例 */
export function resourcePrintBlocks(entries: readonly PrintEntry[]): PrintLegendBlock[] {
  return entries.map((entry): PrintLegendBlock => {
    const row = (label: string, swatch: LegendSwatch): PrintLegendRow => ({
      label,
      drawSwatch: (context, box) => drawLegendSwatch(context, swatch, box, entry.opacity)
    });
    if (entry.kind === 'symbol') {
      return { title: null, rows: [row(entry.title, entry.swatch)] };
    }
    const { title, continued, items } = entry;
    return { title, continued, rows: items.map(item => row(item.label, item.swatch)) };
  });
}
