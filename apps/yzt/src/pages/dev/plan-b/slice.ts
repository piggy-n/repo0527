import type { SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup } from '@mx/map-core';
import type { Resource, ResourceCatalog } from '@/features/resource-map/catalog';
import {
  type ResourceDisplay,
  type ResourceLayersState,
  resourceSourceId,
  resourcesGroup
} from '@/features/resource-map/resource-layers';
import type { ResourceSymbolOverride } from '@/features/resource-map/resource-symbols';
import { sourceLayerOf } from '@/features/resource-map/style-registry';

// 方案 B 的 PoC：验证用的四个资源。样式走真实的 resourcesGroup（登记表、分类、符号覆盖），两种三维引擎用同一份分组；
// 开发页 /dev/plan-b 和测量页（tools/measure-3d）共用，不请求资源树

export interface SliceResource extends Resource {
  /** 用哪一年的瓦片：选后端有数据的年份（最新的年份有的返回"系统异常"） */
  readonly year: number;
  readonly note: string;
}

const resource = (
  index: number,
  code: string,
  name: string,
  geometry: Resource['geometry'],
  year: number,
  note: string,
  minzoom?: number
): SliceResource => ({
  code,
  name,
  geometry,
  years: [year],
  categoryId: '方案 B',
  index,
  year,
  note,
  ...(minzoom === undefined ? {} : { minzoom })
});

/** 排在前面的画在上面 */
export const SLICE: readonly SliceResource[] = [
  resource(0, 'bgdc_xzqjx', '行政区界线', 'line', 2022, '虚线：县级界线改成虚线，市级界线改成点划线'),
  resource(1, 'bgdc_dltb', '地类图斑', 'fill', 2022, '标注：14 级起显示地类名称；后端只有 13 级以上的瓦片'),
  resource(2, 'bgdc_yjjbnttb', '永久基本农田图斑', 'fill', 2022, '花纹：水田斜线、旱地点阵；数据在泰州、南通一带，z10 一张瓦片 6～8 MB', 8),
  // 最小级别表里没有它，这里按同样的 6 MB 规则给 9 级：南京处 z8 一张瓦片 18.8 MB，z9 是 2.6 MB，z10 是 1.2 MB
  resource(3, 'csxhjctb_hyda', '水域面层', 'fill', 2024, '重图层：z10 一张瓦片约 1.2 MB、6500 个要素', 9)
];

/** 重图层不设最小级别时的代码：测量 Cesium 连祖先级别一起请求的代价 */
export const HEAVY_CODE = 'csxhjctb_hyda';

// 符号覆盖：把花纹、虚线这些二维有、Cesium 原生 MVT 画不了的写法都用上
const OVERRIDES: Readonly<Record<string, ResourceSymbolOverride>> = {
  bgdc_xzqjx: { items: { '650200': { dash: 'dashed', width: 'L' }, '640200': { dash: 'dashDot', width: 'XL' } } },
  bgdc_yjjbnttb: { items: { 水田: { fillStyle: 'diagonal' }, 旱地: { fillStyle: 'dot' }, 水浇地: { fillStyle: 'cross' } } }
};

const LABEL_CODE = 'bgdc_dltb';
const LABEL_MIN_ZOOM = 14;

export interface SliceOptions {
  readonly checked: ReadonlySet<string>;
  /** 0～1，各资源相同 */
  readonly opacity: number;
  /** 地类图斑的标注（新项目的资源图层还没有标注，这里加一个 symbol 图层，两种引擎共用） */
  readonly labels: boolean;
  /** 瓦片的基础地址，后面直接拼瓦片集 */
  readonly tileBase: string;
  /** 重图层不设最小级别 */
  readonly unrestricted?: boolean;
}

function labelLayer(year: number): SymbolLayerSpecification {
  const source = resourceSourceId(LABEL_CODE);
  return {
    id: `${source}-label`,
    type: 'symbol',
    source,
    'source-layer': sourceLayerOf(LABEL_CODE, year),
    minzoom: LABEL_MIN_ZOOM,
    layout: { 'text-field': ['get', 'dlmc'], 'text-size': 12, 'text-font': ['Noto Sans Regular'] },
    paint: { 'text-color': '#000000', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1 }
  };
}

/** resources 分组：勾选的资源，加上地类图斑的标注 */
export function sliceGroup({ checked, opacity, labels, tileBase, unrestricted = false }: SliceOptions): StyleGroup {
  const resources = new Map<string, Resource>(
    SLICE.map(item => {
      const { minzoom, ...rest } = item;
      return [item.code, unrestricted && item.code === HEAVY_CODE ? rest : { ...rest, ...(minzoom === undefined ? {} : { minzoom }) }];
    })
  );
  const catalog: ResourceCatalog = { categories: [], resources, problems: [] };
  const displays = new Map<string, ResourceDisplay>(
    SLICE.map(({ code, year }) => [code, { checked: checked.has(code), opacity, year }])
  );
  const state: ResourceLayersState = { catalog, displays, order: SLICE.map(({ code }) => code) };
  const group = resourcesGroup({ state, invalid: new Map(), tileBase, overrideOf: code => OVERRIDES[code] });
  const labelled = SLICE.find(({ code }) => code === LABEL_CODE);
  if (!labels || !labelled || !checked.has(LABEL_CODE)) {
    return group;
  }
  return { ...group, layers: [...group.layers, labelLayer(labelled.year)] };
}

/** 开发页的预设视角 */
export const SLICE_VIEWS = [
  { id: 'province', label: '全省 z7.5', center: [119.5, 33.0], zoom: 7.5, pitch: 0, bearing: 0 },
  { id: 'nanjing-z10', label: '南京 z10', center: [118.8, 32.05], zoom: 10, pitch: 0, bearing: 0 },
  { id: 'nanjing-z12-tilt', label: '南京 z12 倾斜', center: [118.8, 32.05], zoom: 12, pitch: 60, bearing: 20 },
  { id: 'nanjing-z14', label: '南京 z14', center: [118.8, 32.05], zoom: 14.2, pitch: 0, bearing: 0 },
  { id: 'farmland-z12', label: '海安 z12（基本农田）', center: [120.41, 32.6], zoom: 12.2, pitch: 0, bearing: 0 }
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly pitch: number;
  readonly bearing: number;
}[];
