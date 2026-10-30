// @vitest-environment node
import { featureFilter, type LayerSpecification, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import type { ResourceTreeCategory, ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import {
  batchYearOptions,
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  isResourceBodyLayer,
  resourceCodeOfSource,
  type ResourceDisplay,
  type ResourceLayersState,
  resourcesGroup,
  resourceSourceId,
  resourceTileBase,
  validateCatalog,
  withYearForAll
} from './resource-layers';
import { BLANK_PATTERN_IMAGE_ID, patternImageId, patternImages } from './fill-patterns';
import type { ResourceSymbolOverride } from './resource-symbols';
import { resourceStyle } from './style-registry';

const TILE_BASE = 'http://localhost:5173/backend/api/tiles/';

function layer(code: string, geoType: ResourceTreeLayer['geoType'], ...yearList: [number, ...number[]]) {
  return { code, name: code, geoType, yearList };
}

function catalogOf(...layers: ResourceTreeLayer[]) {
  const tree: ResourceTreeCategory[] = [{ code: null, name: '测试', children: layers }];
  return buildCatalog(tree);
}

const DLTB = layer('bgdc_dltb', 'Polygon', 2022);
const CJDCQ = layer('bgdc_cjdcq', 'Polygon', 2023, 2024);
const CJDCQJX = layer('bgdc_cjdcqjx', 'Line', 2022);
const HYDL = layer('csxhjctb_hydl', 'Line', 2023, 2024, 2025);
const GYSSP = layer('csxhjctb_gyssp', 'Point', 2025);
const CZCDYD = layer('bgdc_czcdyd', 'Polygon', 2022);

const CATALOG = catalogOf(DLTB, CJDCQ, CJDCQJX, HYDL, GYSSP);

// 改一个资源的显示状态，返回新的状态
function withDisplay(state: ResourceLayersState, code: string, change: Partial<ResourceDisplay>): ResourceLayersState {
  const display = state.displays.get(code);
  if (!display) {
    throw new Error(`没有资源 ${code}`);
  }
  return { ...state, displays: new Map([...state.displays, [code, { ...display, ...change }]]) };
}

function checkAll(state: ResourceLayersState): ResourceLayersState {
  return state.order.reduce((next, code) => withDisplay(next, code, { checked: true }), state);
}

function derive(state: ResourceLayersState, invalid: ReadonlyMap<string, unknown> = new Map()) {
  return resourcesGroup({ state, invalid, tileBase: TILE_BASE });
}

// 水域线层的配色规则里取值重复：match 要求取值唯一，校验不通过
function styleWithDuplicateValues(code: string) {
  if (code !== 'csxhjctb_hydl') {
    return resourceStyle(code);
  }
  return {
    color: {
      kind: 'values' as const,
      property: 'ccn',
      colors: [
        ['河流', '#1E88E5'],
        ['河流', '#4FC3F7']
      ] as const,
      fallback: '#2F80ED'
    }
  };
}

// 按 MapLibre 的语义求值过滤条件：这种几何类型的要素会被哪些图层画出
function drawnBy(group: StyleGroup, type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'Point'): string[] {
  const feature = { type, properties: {} };
  return group.layers
    .filter(item => 'filter' in item && featureFilter(item.filter, item.id).filter({ zoom: 12 }, feature))
    .map(({ id }) => id);
}

function layerOf(group: StyleGroup, code: string): LayerSpecification {
  const found = group.layers.find(({ id }) => id === resourceSourceId(code));
  if (!found) {
    throw new Error(`分组里没有 ${code} 的图层`);
  }
  return found;
}

describe('ID 与地址', () => {
  it('数据源和图层的 ID 以分组名为前缀，能反查资源', () => {
    expect(resourceSourceId('bgdc_dltb')).toBe('resources-bgdc_dltb');
    expect(resourceCodeOfSource('resources-bgdc_dltb')).toBe('bgdc_dltb');
    expect(resourceCodeOfSource('boundaries-city')).toBeNull();
  });

  it('瓦片的基础地址是绝对地址', () => {
    expect(resourceTileBase('/backend', 'http://localhost:5173')).toBe(TILE_BASE);
  });
});

describe('mergeDisplayState', () => {
  it('第一次合并：顺序同目录，默认值来自登记表（只有地类图斑默认勾选），年份取最新的一年，透明度 1', () => {
    const state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

    expect(state.catalog).toBe(CATALOG);
    expect(state.order).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx', 'csxhjctb_hydl', 'csxhjctb_gyssp']);
    expect(state.displays.get('bgdc_dltb')).toStrictEqual({ checked: true, opacity: 1, year: 2022 });
    expect(state.displays.get('csxhjctb_hydl')).toStrictEqual({ checked: false, opacity: 1, year: 2025 });
  });

  it('同一个目录：返回原来的状态对象', () => {
    const state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

    expect(mergeDisplayState(state, CATALOG)).toBe(state);
  });

  it('目录刷新：仍有的资源保留勾选、透明度和顺序；目录里没有了的删掉', () => {
    let state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);
    state = withDisplay(state, 'csxhjctb_hydl', { checked: true, opacity: 0.4 });
    state = withDisplay(state, 'bgdc_dltb', { checked: false });
    state = { ...state, order: ['csxhjctb_hydl', 'bgdc_cjdcqjx', 'bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_gyssp'] };

    const next = mergeDisplayState(state, catalogOf(DLTB, CJDCQ, HYDL, GYSSP));

    expect(next.order).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_gyssp']);
    expect(next.displays.get('csxhjctb_hydl')).toStrictEqual({ checked: true, opacity: 0.4, year: 2025 });
    expect(next.displays.get('bgdc_dltb')?.checked).toBe(false);
    expect(next.displays.has('bgdc_cjdcqjx')).toBe(false);
  });

  it('新出现的资源用默认值，插到目录里排在它后面的第一个已有资源之前，没有就排在最后', () => {
    let state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalogOf(DLTB, HYDL));
    state = { ...state, order: ['csxhjctb_hydl', 'bgdc_dltb'] };

    // 目录顺序：dltb、新 a、新 b、hydl、新 z
    const next = mergeDisplayState(state, catalogOf(DLTB, CJDCQ, CJDCQJX, HYDL, GYSSP));

    expect(next.order).toStrictEqual(['bgdc_cjdcq', 'bgdc_cjdcqjx', 'csxhjctb_hydl', 'bgdc_dltb', 'csxhjctb_gyssp']);
    expect(next.displays.get('bgdc_cjdcq')).toStrictEqual({ checked: false, opacity: 1, year: 2024 });
  });

  it('年份：仍在资源的年份里就保留，否则改用最新的一年', () => {
    let state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);
    state = withDisplay(state, 'csxhjctb_hydl', { year: 2023 });
    state = withDisplay(state, 'bgdc_cjdcq', { year: 2023 });

    const next = mergeDisplayState(state, catalogOf(DLTB, layer('bgdc_cjdcq', 'Polygon', 2024, 2025), HYDL));

    expect(next.displays.get('csxhjctb_hydl')?.year).toBe(2023);
    expect(next.displays.get('bgdc_cjdcq')?.year).toBe(2025);
  });
});

describe('resourcesGroup', () => {
  const initial = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

  it('目录还没加载：空分组', () => {
    expect(derive(EMPTY_RESOURCE_LAYERS)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('只放勾选且校验通过的资源；面板上排在前面的画在上面（样式里的图层从下到上）', () => {
    let state = withDisplay(initial, 'csxhjctb_hydl', { checked: true });
    state = withDisplay(state, 'csxhjctb_gyssp', { checked: true });
    state = { ...state, order: ['csxhjctb_gyssp', 'bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx', 'csxhjctb_hydl'] };

    const group = derive(state, new Map([['bgdc_dltb', ['配置错误']]]));

    expect(group.layers.map(({ id }) => id)).toStrictEqual(['resources-csxhjctb_hydl', 'resources-csxhjctb_gyssp']);
    expect(Object.keys(group.sources)).toStrictEqual(['resources-csxhjctb_hydl', 'resources-csxhjctb_gyssp']);
  });

  it('数据源：瓦片地址按选中的年份，最大级别 15；有最小显示级别的资源，数据源和图层用同一个级别', () => {
    let state = checkAll(initial);
    state = withDisplay(state, 'csxhjctb_hydl', { year: 2023 });

    const group = derive(state);

    expect(group.sources['resources-csxhjctb_hydl']).toStrictEqual({
      type: 'vector',
      tiles: [`${TILE_BASE}csxhjctb_hydl_2023/{z}/{x}/{y}.pbf`],
      maxzoom: 15
    });
    expect(layerOf(group, 'csxhjctb_hydl')).toMatchObject({ 'source-layer': 'csxhjctb_hydl_2023' });
    expect(group.sources['resources-bgdc_cjdcq']).toMatchObject({ minzoom: 9, maxzoom: 15 });
    expect(layerOf(group, 'bgdc_cjdcq').minzoom).toBe(9);
    expect(layerOf(group, 'csxhjctb_hydl').minzoom).toBeUndefined();
  });

  it('地类图斑带 promoteId；瓦片图层名的例外按年份生效', () => {
    const state = checkAll(mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalogOf(DLTB, CZCDYD)));

    const group = derive(state);

    expect(group.sources['resources-bgdc_dltb']).toMatchObject({ promoteId: 'bsm' });
    expect(group.sources['resources-bgdc_czcdyd']).not.toHaveProperty('promoteId');
    expect(layerOf(group, 'bgdc_czcdyd')['source-layer' as keyof LayerSpecification]).toBe('czcdyd');
  });

  it('透明度乘在各几何类型的不透明度上：面、线，点连同白描边', () => {
    let state = checkAll(initial);
    state = withDisplay(state, 'bgdc_cjdcq', { opacity: 0.5 });
    state = withDisplay(state, 'bgdc_cjdcqjx', { opacity: 0.6 });
    state = withDisplay(state, 'csxhjctb_gyssp', { opacity: 0.7 });

    const group = derive(state);

    expect(layerOf(group, 'bgdc_cjdcq').paint).toMatchObject({ 'fill-opacity': 0.5 });
    expect(layerOf(group, 'bgdc_cjdcqjx').paint).toMatchObject({ 'line-opacity': 0.6 });
    expect(layerOf(group, 'csxhjctb_gyssp').paint).toMatchObject({
      'circle-opacity': 0.7,
      'circle-stroke-opacity': 0.7
    });
  });

  it('面按需拆层（ADR 0045）：纹理图层、描边图层的 ID 加后缀，共用数据源、过滤和最小级别，透明度乘在每个图层上', () => {
    const state = withDisplay(checkAll(initial), 'bgdc_cjdcq', { opacity: 0.4 });
    const overrides: Record<string, ResourceSymbolOverride> = {
      bgdc_cjdcq: { uniform: { fillStyle: 'cross', outlineWidth: 'L' } }
    };
    const group = resourcesGroup({ state, invalid: new Map(), tileBase: TILE_BASE, overrideOf: code => overrides[code] });
    const parts = group.layers.filter(({ id }) => id === 'resources-bgdc_cjdcq' || id.startsWith('resources-bgdc_cjdcq-'));

    expect(parts.map(({ id }) => id)).toStrictEqual([
      'resources-bgdc_cjdcq',
      'resources-bgdc_cjdcq-pattern',
      'resources-bgdc_cjdcq-outline'
    ]);
    const main = layerOf(group, 'bgdc_cjdcq');
    for (const part of parts) {
      expect(part).toMatchObject({
        source: 'resources-bgdc_cjdcq',
        filter: 'filter' in main ? main.filter : undefined,
        minzoom: resourceStyle('bgdc_cjdcq').minzoom
      });
      expect('source-layer' in part && part['source-layer']).toBe('source-layer' in main && main['source-layer']);
    }
    expect(parts.map(part => part.paint)).toMatchObject([
      { 'fill-opacity': 0.4 },
      { 'fill-opacity': 0.4 },
      { 'line-opacity': 0.4 }
    ]);
    expect(validateStyleMin({ version: 8, sources: group.sources, layers: group.layers.slice() })).toStrictEqual([]);
  });

  it('画出要素本身的图层（ADR 0050）：主图层和线按线型拆出的图层；纹理、描边图层和别的资源的图层不算', () => {
    const overrides: Record<string, ResourceSymbolOverride> = {
      bgdc_cjdcq: { uniform: { fillStyle: 'cross', outlineWidth: 'L', outlineDash: 'dashed' } },
      bgdc_dltb: { items: { '0101': { fillStyle: 'dot', outlineWidth: 'L', outlineDash: 'dotted' } } },
      csxhjctb_hydl: { items: { 水渠: { dash: 'dashed' }, 河流: { dash: 'dashDot' } } }
    };
    const group = resourcesGroup({
      state: checkAll(initial),
      invalid: new Map(),
      tileBase: TILE_BASE,
      overrideOf: code => overrides[code]
    });
    const layersOf = (code: string) => {
      const id = resourceSourceId(code);
      return group.layers.map(item => item.id).filter(layerId => layerId === id || layerId.startsWith(`${id}-`));
    };
    const bodyOf = (code: string) => layersOf(code).filter(id => isResourceBodyLayer(code, id));

    expect(layersOf('bgdc_dltb')).toContain('resources-bgdc_dltb-outline-dotted');
    expect(bodyOf('bgdc_dltb')).toStrictEqual(['resources-bgdc_dltb']);
    expect(layersOf('bgdc_cjdcq')).toStrictEqual([
      'resources-bgdc_cjdcq',
      'resources-bgdc_cjdcq-pattern',
      'resources-bgdc_cjdcq-outline'
    ]);
    expect(bodyOf('bgdc_cjdcq')).toStrictEqual(['resources-bgdc_cjdcq']);
    expect(bodyOf('csxhjctb_hydl')).toStrictEqual(layersOf('csxhjctb_hydl'));
    expect(bodyOf('csxhjctb_hydl')).toHaveLength(3);
    expect(bodyOf('csxhjctb_gyssp')).toStrictEqual(['resources-csxhjctb_gyssp']);
    expect(isResourceBodyLayer('bgdc_dltb', 'resources-bgdc_dltb_czc')).toBe(false);
    expect(isResourceBodyLayer('bgdc_dltb', 'resources-bgdc_cjdcq')).toBe(false);
  });

  it('按线型拆层（ADR 0046）：其他线型的图层 ID 加后缀，在几何过滤之外按要素的线型过滤，共用数据源，透明度乘在每个图层上', () => {
    const state = withDisplay(checkAll(initial), 'csxhjctb_hydl', { opacity: 0.6 });
    const overrides: Record<string, ResourceSymbolOverride> = { csxhjctb_hydl: { items: { 水渠: { dash: 'dashed' } } } };
    const group = resourcesGroup({ state, invalid: new Map(), tileBase: TILE_BASE, overrideOf: code => overrides[code] });
    const parts = group.layers.filter(({ id }) => id.startsWith('resources-csxhjctb_hydl'));
    const drawn = (type: 'LineString' | 'Polygon', properties: Record<string, string>) =>
      parts
        .filter(item => 'filter' in item && featureFilter(item.filter, item.id).filter({ zoom: 12 }, { type, properties }))
        .map(({ id }) => id);

    expect(parts.map(({ id }) => id)).toStrictEqual(['resources-csxhjctb_hydl', 'resources-csxhjctb_hydl-dashed']);
    expect(drawn('LineString', { ccn: '河流' })).toStrictEqual(['resources-csxhjctb_hydl']);
    expect(drawn('LineString', { ccn: '水渠' })).toStrictEqual(['resources-csxhjctb_hydl-dashed']);
    // 几何类型的过滤仍然生效
    expect(drawn('Polygon', { ccn: '水渠' })).toStrictEqual([]);
    expect(parts).toMatchObject([
      { source: 'resources-csxhjctb_hydl', paint: { 'line-opacity': 0.6 } },
      { source: 'resources-csxhjctb_hydl', paint: { 'line-opacity': 0.6, 'line-dasharray': [3, 2] } }
    ]);
    expect(validateStyleMin({ version: 8, sources: group.sources, layers: group.layers.slice() })).toStrictEqual([]);
  });

  it('分组带上用到的图片：几个资源用同一种花纹时是同一张；没有花纹时不带 images', () => {
    const state = checkAll(initial);
    const overrides: Record<string, ResourceSymbolOverride> = {
      bgdc_cjdcq: { uniform: { fillStyle: 'dot' } },
      bgdc_dltb: { items: { '0101': { fillStyle: 'dot' } } }
    };
    const group = resourcesGroup({ state, invalid: new Map(), tileBase: TILE_BASE, overrideOf: code => overrides[code] });

    expect(Object.keys(group.images ?? {}).toSorted()).toStrictEqual(
      [BLANK_PATTERN_IMAGE_ID, ...([0, 1, 2] as const).map(band => patternImageId('dot', band))].toSorted()
    );
    expect(group.images?.[patternImageId('dot', 1)]).toBe(patternImages(['dot'], false)[patternImageId('dot', 1)]);
    expect(derive(state)).not.toHaveProperty('images');
  });

  it('每个图层只画自己几何类型的要素：面图层不画退化成线的要素', () => {
    const group = derive(checkAll(initial));

    expect(drawnBy(group, 'MultiPolygon')).toStrictEqual(drawnBy(group, 'Polygon'));
    expect(drawnBy(group, 'Polygon')).toStrictEqual(['resources-bgdc_cjdcq', 'resources-bgdc_dltb']);
    expect(drawnBy(group, 'LineString')).toStrictEqual(['resources-csxhjctb_hydl', 'resources-bgdc_cjdcqjx']);
    expect(drawnBy(group, 'Point')).toStrictEqual(['resources-csxhjctb_gyssp']);
  });

  it('全部勾选时的分组能通过 MapLibre 的校验', () => {
    const { sources, layers } = derive(checkAll(initial));

    expect(validateStyleMin({ version: 8, sources, layers: layers.slice() })).toStrictEqual([]);
  });
});

describe('validateCatalog', () => {
  it('登记表生成的配置都合法；目录还没加载时没有要校验的', () => {
    expect(validateCatalog(CATALOG, TILE_BASE)).toStrictEqual(new Map());
    expect(validateCatalog(null, TILE_BASE)).toStrictEqual(new Map());
  });

  it('配置不合法（如按属性配色的取值重复）：记下这个资源和原因，其他资源照常', () => {
    const invalid = validateCatalog(CATALOG, TILE_BASE, styleWithDuplicateValues);

    expect([...invalid.keys()]).toStrictEqual(['csxhjctb_hydl']);
    expect(invalid.get('csxhjctb_hydl')?.join()).toContain('unique');
  });
});

describe('批量设置年份（ADR 0052 第 2 节）', () => {
  const initial = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

  it('可选的年份：多年份资源的年份并集加上固定的 2020、2021（ADR 0094），新的在前；只出现在单年份资源里的其他年份不列出；目录还没加载时没有', () => {
    // 2022 只有地类图斑、村级调查区界线（单年份），不列出；2025 有水域线层（多年份）
    expect(batchYearOptions(CATALOG)).toStrictEqual([2025, 2024, 2023, 2021, 2020]);
    expect(batchYearOptions(catalogOf(DLTB, GYSSP))).toStrictEqual([2021, 2020]);
    expect(batchYearOptions(null)).toStrictEqual([]);
  });

  it('有这一年的资源不论是否勾选都切过去，没有的不变；勾选、透明度、顺序不变', () => {
    const state = withDisplay(initial, 'csxhjctb_hydl', { checked: true, opacity: 0.4 });

    const next = withYearForAll(state, 2023);

    expect(next.displays.get('csxhjctb_hydl')).toStrictEqual({ checked: true, opacity: 0.4, year: 2023 });
    expect(next.displays.get('bgdc_cjdcq')).toStrictEqual({ checked: false, opacity: 1, year: 2023 });
    expect(next.displays.get('bgdc_dltb')).toBe(state.displays.get('bgdc_dltb'));
    expect(next.displays.get('csxhjctb_gyssp')).toBe(state.displays.get('csxhjctb_gyssp'));
    expect(next.order).toBe(state.order);
    expect(next.catalog).toBe(state.catalog);
  });

  it('没有资源要改时返回原来的状态，没有任何资源有这一年、目录还没加载时也是（ADR 0094）；年份不是整数时抛错', () => {
    // 2022 只有地类图斑和村级调查区界线有，它们本来就是 2022
    expect(withYearForAll(initial, 2022)).toBe(initial);
    const at2024 = withYearForAll(initial, 2024);
    expect(at2024).not.toBe(initial);
    expect(withYearForAll(at2024, 2024)).toBe(at2024);

    expect(withYearForAll(initial, 2021)).toBe(initial);
    expect(withYearForAll(EMPTY_RESOURCE_LAYERS, 2024)).toBe(EMPTY_RESOURCE_LAYERS);
    expect(() => withYearForAll(initial, 2023.5)).toThrow('年份应是整数，收到 2023.5');
  });
});
