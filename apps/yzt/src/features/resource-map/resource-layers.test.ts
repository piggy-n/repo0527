// @vitest-environment node
import { featureFilter, type LayerSpecification, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import type { ResourceTreeCategory, ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import {
  addedCodes,
  batchYearOptions,
  EMPTY_RESOURCE_LAYERS,
  isDrawn,
  mergeDisplayState,
  isResourceBodyLayer,
  labelTargetOf,
  resourceCodeOfSource,
  type ResourceDisplay,
  type ResourceLayersState,
  resourceLabelsGroup,
  resourcesGroup,
  resourceSourceId,
  resourceTileBase,
  validateCatalog,
  withAdded,
  withMoved,
  withRemoved,
  withYearForAll
} from './resource-layers';
import { BLANK_PATTERN_IMAGE_ID, patternImageId, patternImages } from './fill-patterns';
import { resourceLabelLayer } from './labels';
import { POINT_SHAPE_NAMES, shapeImageId } from './point-shapes';
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
// 有最小显示级别的资源：面 8 级，线 9 级
const YJJBNTTB = layer('bgdc_yjjbnttb', 'Polygon', 2025);
const LRDL = layer('csxhjctb_lrdl', 'Line', 2026);

const CATALOG = catalogOf(DLTB, CJDCQ, CJDCQJX, HYDL, GYSSP);

// 改一个资源的显示状态，返回新的状态
function withDisplay(state: ResourceLayersState, code: string, change: Partial<ResourceDisplay>): ResourceLayersState {
  const display = state.displays.get(code);
  if (!display) {
    throw new Error(`没有资源 ${code}`);
  }
  return { ...state, displays: new Map([...state.displays, [code, { ...display, ...change }]]) };
}

// 全部加入当前地图并显示，顺序不变
function checkAll(state: ResourceLayersState): ResourceLayersState {
  return state.order.reduce((next, code) => withDisplay(next, code, { added: true, checked: true }), state);
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
      entries: [
        { value: '河流', label: '河流', color: '#1E88E5' },
        { value: '河流', label: '河流', color: '#4FC3F7' }
      ],
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
  it('第一次合并：顺序同目录，默认值来自登记表（只有地类图斑默认加入并显示），年份取最新的一年，透明度 1', () => {
    const state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

    expect(state.catalog).toBe(CATALOG);
    expect(state.order).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx', 'csxhjctb_hydl', 'csxhjctb_gyssp']);
    expect(state.displays.get('bgdc_dltb')).toStrictEqual({
      added: true,
      checked: true,
      opacity: 1,
      year: 2022,
      labeled: false
    });
    expect(state.displays.get('csxhjctb_hydl')).toStrictEqual({
      added: false,
      checked: false,
      opacity: 1,
      year: 2025,
      labeled: false
    });
  });

  it('同一个目录：返回原来的状态对象', () => {
    const state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

    expect(mergeDisplayState(state, CATALOG)).toBe(state);
  });

  it('目录刷新：仍有的资源保留加入、勾选、透明度和顺序；目录里没有了的删掉', () => {
    let state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);
    state = withDisplay(state, 'csxhjctb_hydl', { added: true, checked: true, opacity: 0.4 });
    state = withDisplay(state, 'bgdc_dltb', { checked: false });
    state = { ...state, order: ['csxhjctb_hydl', 'bgdc_cjdcqjx', 'bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_gyssp'] };

    const next = mergeDisplayState(state, catalogOf(DLTB, CJDCQ, HYDL, GYSSP));

    expect(next.order).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_gyssp']);
    expect(next.displays.get('csxhjctb_hydl')).toStrictEqual({
      added: true,
      checked: true,
      opacity: 0.4,
      year: 2025,
      labeled: false
    });
    expect(next.displays.get('bgdc_dltb')?.checked).toBe(false);
    expect(next.displays.has('bgdc_cjdcqjx')).toBe(false);
  });

  it('新出现的资源用默认值，按目录的顺序排在最后；已有的顺序不按目录树整理（ADR 0157）', () => {
    let state = mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalogOf(DLTB, HYDL));
    state = { ...state, order: ['csxhjctb_hydl', 'bgdc_dltb'] };

    const next = mergeDisplayState(state, catalogOf(DLTB, CJDCQ, CJDCQJX, HYDL, GYSSP));

    expect(next.order).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx', 'csxhjctb_gyssp']);
    expect(next.displays.get('bgdc_cjdcq')).toStrictEqual({
      added: false,
      checked: false,
      opacity: 1,
      year: 2024,
      labeled: false
    });
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

describe('当前地图：加入、移出、挪动（ADR 0157）', () => {
  // 初始只有地类图斑在当前地图里
  const initial = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

  it('画在地图上要已加入并且显示', () => {
    expect(isDrawn(undefined)).toBe(false);
    expect(isDrawn({ added: true, checked: true, opacity: 1, year: 2022, labeled: false })).toBe(true);
    expect(isDrawn({ added: true, checked: false, opacity: 1, year: 2022, labeled: false })).toBe(false);
    expect(isDrawn({ added: false, checked: true, opacity: 1, year: 2022, labeled: false })).toBe(false);
  });

  it('加入：放到最前面并显示；一次加多个时整批在最前，批内保持给出的先后；已加入的不动、不重复', () => {
    const hidden = withDisplay(initial, 'csxhjctb_gyssp', { checked: false });

    const next = withAdded(hidden, ['csxhjctb_hydl', 'bgdc_dltb', 'csxhjctb_gyssp', 'csxhjctb_hydl']);

    expect(addedCodes(next)).toStrictEqual(['csxhjctb_hydl', 'csxhjctb_gyssp', 'bgdc_dltb']);
    expect(next.order).toStrictEqual(['csxhjctb_hydl', 'csxhjctb_gyssp', 'bgdc_dltb', 'bgdc_cjdcq', 'bgdc_cjdcqjx']);
    expect(next.displays.get('csxhjctb_gyssp')).toMatchObject({ added: true, checked: true });
  });

  it('移出：设置保留；移出后再加入，重新放到最前面并显示，透明度和年份沿用', () => {
    let state = withAdded(initial, ['csxhjctb_hydl']);
    state = withDisplay(state, 'bgdc_dltb', { opacity: 0.5, checked: false });

    state = withRemoved(state, ['bgdc_dltb']);
    expect(addedCodes(state)).toStrictEqual(['csxhjctb_hydl']);
    expect(state.displays.get('bgdc_dltb')).toStrictEqual({
      added: false,
      checked: false,
      opacity: 0.5,
      year: 2022,
      labeled: false
    });

    state = withAdded(state, ['bgdc_dltb']);
    expect(addedCodes(state)).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl']);
    expect(state.displays.get('bgdc_dltb')).toStrictEqual({
      added: true,
      checked: true,
      opacity: 0.5,
      year: 2022,
      labeled: false
    });
  });

  it('没有要加入、移出的时返回原来的状态对象；有目录里没有的资源时抛错', () => {
    expect(withAdded(initial, ['bgdc_dltb'])).toBe(initial);
    expect(withAdded(initial, [])).toBe(initial);
    expect(withRemoved(initial, ['csxhjctb_hydl'])).toBe(initial);
    expect(() => withAdded(initial, ['bgdc_dltb', 'nope'])).toThrow('目录里没有资源 nope');
    expect(() => withRemoved(initial, ['nope'])).toThrow('目录里没有资源 nope');
  });

  it('挪动：按已加入的资源里的位置，已加入的排在最前，没加入的跟在后面', () => {
    const state = withAdded(initial, ['csxhjctb_hydl', 'csxhjctb_gyssp']);

    const next = withMoved(state, 'bgdc_dltb', 0);

    expect(addedCodes(next)).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl', 'csxhjctb_gyssp']);
    expect(next.order).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl', 'csxhjctb_gyssp', 'bgdc_cjdcq', 'bgdc_cjdcqjx']);
    expect(addedCodes(withMoved(next, 'bgdc_dltb', 2))).toStrictEqual(['csxhjctb_hydl', 'csxhjctb_gyssp', 'bgdc_dltb']);
  });

  it('挪动：位置不变时返回原来的状态对象；没加入、位置越界时抛错', () => {
    const state = withAdded(initial, ['csxhjctb_hydl']);

    expect(withMoved(state, 'bgdc_dltb', 1)).toBe(state);
    expect(() => withMoved(state, 'bgdc_cjdcq', 0)).toThrow('资源 bgdc_cjdcq 不在当前地图里');
    expect(() => withMoved(state, 'bgdc_dltb', 2)).toThrow(RangeError);
    expect(() => withMoved(state, 'bgdc_dltb', -1)).toThrow(RangeError);
    expect(() => withMoved(state, 'bgdc_dltb', 0.5)).toThrow(RangeError);
  });
});

describe('resourcesGroup', () => {
  const initial = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

  it('目录还没加载：空分组', () => {
    expect(derive(EMPTY_RESOURCE_LAYERS)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('只放已加入、显示且校验通过的资源；面板上排在前面的画在上面（样式里的图层从下到上）', () => {
    let state = withDisplay(initial, 'csxhjctb_hydl', { added: true, checked: true });
    state = withDisplay(state, 'csxhjctb_gyssp', { added: true, checked: true });
    // 加入了但隐藏、勾选着但没加入的都不画
    state = withDisplay(state, 'bgdc_cjdcq', { added: true, checked: false });
    state = withDisplay(state, 'bgdc_cjdcqjx', { added: false, checked: true });
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
    expect(layerOf(group, 'csxhjctb_hydl').minzoom).toBeUndefined();
  });

  it('有最小显示级别的资源，数据源和图层用同一个级别', () => {
    const group = derive(checkAll(mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalogOf(LRDL))));

    expect(group.sources['resources-csxhjctb_lrdl']).toMatchObject({ minzoom: 9, maxzoom: 15 });
    expect(layerOf(group, 'csxhjctb_lrdl').minzoom).toBe(9);
  });

  it('级别跟着目录走：部署的配置改了就用新的，配置里没写的数据源和图层都不设（ADR 0137）', () => {
    const tree: ResourceTreeCategory[] = [{ code: null, name: '测试', children: [LRDL, YJJBNTTB] }];
    const catalog = buildCatalog(tree, { csxhjctb_lrdl: 12 });

    const group = derive(checkAll(mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalog)));

    expect(group.sources['resources-csxhjctb_lrdl']).toMatchObject({ minzoom: 12 });
    expect(layerOf(group, 'csxhjctb_lrdl').minzoom).toBe(12);
    expect(group.sources['resources-bgdc_yjjbnttb']).toMatchObject({ maxzoom: 15 });
    expect(group.sources['resources-bgdc_yjjbnttb']).not.toHaveProperty('minzoom');
    expect(layerOf(group, 'bgdc_yjjbnttb')).not.toHaveProperty('minzoom');
  });

  it('地类图斑带 promoteId；瓦片图层名默认等于瓦片集名（2026-11-01 探查，城镇村等用地不再是例外）', () => {
    const state = checkAll(mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalogOf(DLTB, CZCDYD)));

    const group = derive(state);

    expect(group.sources['resources-bgdc_dltb']).toMatchObject({ promoteId: 'bsm' });
    expect(group.sources['resources-bgdc_czcdyd']).not.toHaveProperty('promoteId');
    expect(layerOf(group, 'bgdc_czcdyd')['source-layer' as keyof LayerSpecification]).toBe('bgdc_czcdyd_2022');
  });

  it('透明度乘在各几何类型的不透明度上：面、线，点是图标的透明度，连同白描边（ADR 0159）', () => {
    let state = checkAll(initial);
    state = withDisplay(state, 'bgdc_cjdcq', { opacity: 0.5 });
    state = withDisplay(state, 'bgdc_cjdcqjx', { opacity: 0.6 });
    state = withDisplay(state, 'csxhjctb_gyssp', { opacity: 0.7 });

    const group = derive(state);

    expect(layerOf(group, 'bgdc_cjdcq').paint).toMatchObject({ 'fill-opacity': 0.5 });
    expect(layerOf(group, 'bgdc_cjdcqjx').paint).toMatchObject({ 'line-opacity': 0.6 });
    expect(layerOf(group, 'csxhjctb_gyssp')).toMatchObject({ type: 'symbol', paint: { 'icon-opacity': 0.7 } });
  });

  it('点的透明度不低于 10%（ADR 0159）：SDF 符号的着色器在不透明度低于 0.1 时整个不画；0 照样是 0', () => {
    const opacityOf = (opacity: number) => {
      const group = derive(withDisplay(checkAll(initial), 'csxhjctb_gyssp', { opacity }));
      const point = layerOf(group, 'csxhjctb_gyssp');
      return point.type === 'symbol' ? point.paint?.['icon-opacity'] : undefined;
    };

    expect([0, 0.01, 0.05, 0.1, 0.5].map(opacityOf)).toStrictEqual([0, 0.1, 0.1, 0.1, 0.5]);
    // 面、线照原样
    const group = derive(withDisplay(checkAll(initial), 'bgdc_cjdcq', { opacity: 0.05 }));
    expect(layerOf(group, 'bgdc_cjdcq').paint).toMatchObject({ 'fill-opacity': 0.05 });
  });

  it('面按需拆层（ADR 0045）：纹理图层、描边图层的 ID 加后缀，共用数据源、过滤和最小级别，透明度乘在每个图层上', () => {
    const code = 'bgdc_yjjbnttb';
    const state = withDisplay(checkAll(mergeDisplayState(EMPTY_RESOURCE_LAYERS, catalogOf(YJJBNTTB))), code, { opacity: 0.4 });
    const overrides: Record<string, ResourceSymbolOverride> = {
      [code]: { mode: 'uniform', uniform: { fillStyle: 'cross', outlineWidth: 'L' } }
    };
    const group = resourcesGroup({ state, invalid: new Map(), tileBase: TILE_BASE, overrideOf: item => overrides[item] });
    const parts = group.layers.filter(({ id }) => id === `resources-${code}` || id.startsWith(`resources-${code}-`));

    expect(parts.map(({ id }) => id)).toStrictEqual([
      `resources-${code}`,
      `resources-${code}-pattern`,
      `resources-${code}-outline`
    ]);
    const main = layerOf(group, code);
    for (const part of parts) {
      expect(part).toMatchObject({
        source: `resources-${code}`,
        filter: 'filter' in main ? main.filter : undefined,
        minzoom: 8
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

    // 公用设施点层的圆形图片也在（ADR 0159）
    expect(Object.keys(group.images ?? {}).toSorted()).toStrictEqual(
      [
        BLANK_PATTERN_IMAGE_ID,
        ...([0, 1, 2] as const).map(band => patternImageId('dot', band)),
        shapeImageId('circle')
      ].toSorted()
    );
    expect(group.images?.[patternImageId('dot', 1)]).toBe(patternImages(['dot'], false)[patternImageId('dot', 1)]);
    // 没有花纹时只有点的形状图片（ADR 0159）
    expect(Object.keys(derive(state).images ?? {})).toStrictEqual([shapeImageId('circle')]);
    const noPoints = withDisplay(state, 'csxhjctb_gyssp', { checked: false });
    expect(derive(noPoints)).not.toHaveProperty('images');
  });

  it.each(POINT_SHAPE_NAMES)('点的形状 %s（ADR 0159）：放进分组能通过 MapLibre 的校验，带上这种形状的图片', shape => {
    const state = withDisplay(checkAll(initial), 'csxhjctb_gyssp', { opacity: 0.4 });
    const overrides: Record<string, ResourceSymbolOverride> = {
      csxhjctb_gyssp: { items: { '080901': { shape, size: 'XL', strokeWidth: 3 }, $other: { shape: 'pin' } } }
    };
    const group = resourcesGroup({ state, invalid: new Map(), tileBase: TILE_BASE, overrideOf: code => overrides[code] });

    expect(validateStyleMin({ version: 8, sources: group.sources, layers: group.layers.slice() })).toStrictEqual([]);
    expect(Object.keys(group.images ?? {})).toContain(shapeImageId(shape));
    expect(layerOf(group, 'csxhjctb_gyssp')).toMatchObject({ type: 'symbol', paint: { 'icon-opacity': 0.4 } });
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

const idsOf = (group: StyleGroup) => group.layers.map(({ id }) => id);

// 全部开着标注
const labelAll = (state: ResourceLayersState) =>
  state.order.reduce((next, code) => withDisplay(next, code, { labeled: true }), state);

describe('resourceLabelsGroup（ADR 0160）', () => {
  const initial = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);

  it('默认都不开标注（用户 2026-11-16）：分组为空', () => {
    expect([...initial.displays.values()].some(display => display.labeled)).toBe(false);
    const group = resourceLabelsGroup({ state: checkAll(initial), invalid: new Map() });
    expect(group).toStrictEqual({ sources: {}, layers: [] });
  });

  it('只给画在地图上、开着标注、校验通过、登记了字段的资源；用资源分组里的数据源', () => {
    // 村级调查区隐藏，公用设施点校验不通过，村级调查区界线没有登记字段
    const state = withDisplay(labelAll(checkAll(initial)), 'bgdc_cjdcq', { checked: false });
    const group = resourceLabelsGroup({ state, invalid: new Map([['csxhjctb_gyssp', ['不合法']]]) });
    const resources = derive(state, new Map([['csxhjctb_gyssp', ['不合法']]]));

    expect(idsOf(group)).toStrictEqual(['resource-labels-bgdc_dltb', 'resource-labels-csxhjctb_hydl']);
    expect(group.sources).toStrictEqual({});
    expect(group.layers.flatMap(item => ('source' in item ? [item.source] : [])).toSorted()).toStrictEqual(
      Object.keys(resources.sources)
        .filter(id => id !== 'resources-bgdc_cjdcqjx')
        .toSorted()
    );
  });

  it('透明度为 0 的资源不推导标注：看不见的文字不占位、不挡别的标注，也点不到', () => {
    const state = withDisplay(labelAll(checkAll(initial)), 'bgdc_dltb', { opacity: 0 });

    expect(idsOf(resourceLabelsGroup({ state, invalid: new Map() }))).not.toContain('resource-labels-bgdc_dltb');
    expect(idsOf(resourceLabelsGroup({ state, invalid: new Map() }))).toContain('resource-labels-csxhjctb_hydl');
  });

  it('加强标注的要素只在它所在资源的标注里滤掉', () => {
    const group = resourceLabelsGroup({
      state: labelAll(checkAll(initial)),
      invalid: new Map(),
      emphasis: { code: 'bgdc_dltb', guid: 'a'.repeat(32) }
    });
    const filterOf = (code: string) => {
      const found = group.layers.find(item => item.id === `resource-labels-${code}`);
      return found && 'filter' in found ? JSON.stringify(found.filter) : '';
    };

    expect(filterOf('bgdc_dltb')).toContain(`"!=",["to-string",["get","guid"]],"${'a'.repeat(32)}"`);
    expect(filterOf('csxhjctb_hydl')).not.toContain('guid');
  });

  it('点的文字让开画出的点：按资源的符号和覆盖算，点改大、换成定位针时偏移跟着变；线、面没有', () => {
    const points = CATALOG.resources.get('csxhjctb_gyssp');
    const lines = CATALOG.resources.get('csxhjctb_hydl');
    if (!points || !lines) {
      throw new Error('目录里没有公用设施点或水域线');
    }
    const display: ResourceDisplay = { added: true, checked: true, opacity: 1, year: 2025, labeled: true };
    // 16 级（曲线的最后一个断点）往上让开多少
    const upAt16 = (override?: ResourceSymbolOverride) => labelTargetOf(points, display, override)?.reach?.at(-1)?.up;

    // 默认 M 档、半径 6，白描边 1
    expect(upAt16()).toBe(7);
    expect(upAt16({ mode: 'uniform', uniform: { size: 'XL' } })).toBeGreaterThan(7);
    // 定位针从针尖往上伸出 2.4 倍半径
    expect(upAt16({ items: { '080901': { shape: 'pin' } } })).toBeCloseTo(2.4 * 6 + 1);
    expect(labelTargetOf(lines, display, undefined)?.reach).toBeNull();

    const target = labelTargetOf(points, display, { items: { '080901': { shape: 'pin' } } });
    const offset = target && resourceLabelLayer(target).layout?.['text-offset'];
    // 16 级的偏移：(针头 15.4 + 间隔 3) / 12 号字，往上
    expect(JSON.stringify(offset)).toContain(`16,["literal",[0,${-Number((18.4 / 12).toFixed(3))}]]`);
  });

  it('标注图层不算画出要素本身的图层：框选的估数不数它（ADR 0050）', () => {
    expect(isResourceBodyLayer('bgdc_dltb', 'resource-labels-bgdc_dltb')).toBe(false);
    expect(isResourceBodyLayer('bgdc_dltb', 'selection-labels-bgdc_dltb')).toBe(false);
  });

  it('开着标注时和资源分组一起通过 MapLibre 的校验（样式不写 glyphs）', () => {
    const state = labelAll(checkAll(initial));
    const { sources, layers } = derive(state);
    const labels = resourceLabelsGroup({ state, invalid: new Map() }).layers;

    expect(labels.length).toBeGreaterThan(0);
    expect(validateStyleMin({ version: 8, sources, layers: [...layers, ...labels] })).toStrictEqual([]);
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

  it('有这一年的资源不论是否加入都切过去，没有的不变；加入、勾选、透明度、顺序不变', () => {
    const state = withDisplay(initial, 'csxhjctb_hydl', { added: true, checked: true, opacity: 0.4 });

    const next = withYearForAll(state, 2023);

    expect(next.displays.get('csxhjctb_hydl')).toStrictEqual({
      added: true,
      checked: true,
      opacity: 0.4,
      year: 2023,
      labeled: false
    });
    expect(next.displays.get('bgdc_cjdcq')).toStrictEqual({
      added: false,
      checked: false,
      opacity: 1,
      year: 2023,
      labeled: false
    });
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
