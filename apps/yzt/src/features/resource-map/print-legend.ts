import type { ScreenBox, ToolView } from '@mx/map-core';
import type { PrintLegendBlock, PrintLegendRow } from '@/shared/map/print/print-legend';
import { intersectsScope, type RegionScope } from '@/shared/map/region/region-scope';
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
  readonly view: Pick<ToolView, 'queryRendered'>;
  /** 地图的 CSS 尺寸：整屏查询 */
  readonly size: { readonly width: number; readonly height: number };
  /** 区划裁剪的范围：只算范围里的要素（同点选、框选，ADR 0051）；没有时为 null */
  readonly scope: RegionScope | null;
}

/** 整屏查一次各资源画出来的要素，求出取值 */
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
  const rendered = new Map<string, ReadonlySet<string>>();
  for (const { resource, sourceId } of printedResources(state, invalid, zoom)) {
    const features = view
      .queryRendered(box, { sources: [sourceId], withGeometry: scope !== null })
      .filter(({ geometry }) => scope === null || (geometry !== undefined && intersectsScope(geometry, scope)));
    if (features.length === 0) {
      continue;
    }
    const keyOf = classKeyOf(resource, zoom, overrideOf(resource.code));
    rendered.set(resource.code, new Set(keyOf ? features.map(({ properties }) => keyOf(properties)) : []));
  }
  return rendered;
}

/** 打印图例里的一个取值 */
export interface PrintItem {
  readonly key: string;
  readonly label: string;
  readonly swatch: LegendSwatch;
}

/** 打印图例里的一个资源：统一符号是一行；按属性配色的是一组，只有画面里出现的取值，次序同右侧图例 */
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

/** 打印图例里的资源（纯数据）：符号同右侧图例的推导（legendEntry），名称后面带年份 */
export function printEntries(
  { state, invalid, overrideOf, zoom }: PrintLegendInput,
  rendered: RenderedClasses
): PrintEntry[] {
  return printedResources(state, invalid, zoom).flatMap(({ resource, year }): PrintEntry[] => {
    const present = rendered.get(resource.code);
    if (!present) {
      return [];
    }
    const { code, name } = resource;
    const opacity = state.displays.get(code)?.opacity ?? 1;
    const title = `${name}（${year}）`;
    const entry = legendEntry(resource, year, overrideOf(code));
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
