import type { PickResult, RenderedFeature, RenderedQueryOptions, ScreenBox, ScreenPoint } from '@mx/map-core';
import type { Geometry, Polygon } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import { buildCatalog } from './catalog';
import { classItems, OTHER_ITEM } from './classification';
import type { FeatureFilter } from './feature-filter';
import { CLASS_FIELD } from './filter-fields';
import {
  type PrintEntry,
  printedResources,
  printEntries,
  type RenderedClasses,
  renderedClasses,
  resourcePrintBlocks
} from './print-legend';
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceDisplay,
  type ResourceLayersState
} from './resource-layers';
import type { ResourceSymbolOverride, SymbolOverrideOf } from './resource-symbols';
import { resourceStyle } from './style-registry';

// 每次求交时区划有几个顶点、裁了几次区划：区划边界上万个坐标，每个要素都对着整个边界求交要几秒，
// 精确裁剪整个区划也要近 200 毫秒（ADR 0174 审查）
const calls = vi.hoisted(() => ({ intersections: [] as number[], clips: 0 }));
vi.mock('@/shared/map/region/region-scope', async importOriginal => {
  const actual = await importOriginal<typeof import('@/shared/map/region/region-scope')>();
  return {
    ...actual,
    intersectsScope: (geometry: Geometry, scope: Parameters<typeof actual.intersectsScope>[1]) => {
      calls.intersections.push(JSON.stringify(scope.coordinates).split('],[').length);
      return actual.intersectsScope(geometry, scope);
    },
    clipToScope: (...args: Parameters<typeof actual.clipToScope>) => {
      calls.clips += 1;
      return actual.clipToScope(...args);
    }
  };
});

// 记录从零开始
function resetCalls(): void {
  calls.intersections.length = 0;
  calls.clips = 0;
}

// 地类按编码配色，学校点按学段配色，农田、道路、红线是统一符号；农田 13 级起显示
const CATALOG = buildCatalog(
  [
    {
      code: null,
      name: '测试',
      children: [
        { code: 'bgdc_dltb', name: '地类图斑', geoType: 'Polygon', yearList: [2022] },
        { code: 'csxhjctb_xxp', name: '学校点层', geoType: 'Point', yearList: [2025] },
        { code: 'test_farmland', name: '永久基本农田', geoType: 'Polygon', yearList: [2023] },
        { code: 'test_roads', name: '道路中心线', geoType: 'Line', yearList: [2024] },
        { code: 'test_redline', name: '生态保护红线', geoType: 'Polygon', yearList: [2024] }
      ]
    }
  ],
  { test_farmland: 13 }
);

// 都加入并显示；红线没勾选，道路透明度为 0，地类 0.6
function displayed(): ResourceLayersState {
  const merged = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);
  const patch: Readonly<Record<string, Partial<ResourceDisplay>>> = {
    test_redline: { checked: false },
    test_roads: { opacity: 0 },
    bgdc_dltb: { opacity: 0.6 }
  };
  const displays = new Map(
    [...merged.displays].map(([code, display]) => [code, { ...display, added: true, checked: true, ...patch[code] }])
  );
  return { ...merged, displays };
}

const STATE = displayed();

// 给几个资源加上过滤条件
function withFilters(filters: Readonly<Record<string, FeatureFilter>>): ResourceLayersState {
  const displays = new Map(
    [...STATE.displays].map(([code, display]) => [code, { ...display, filter: filters[code] ?? display.filter }])
  );
  return { ...STATE, displays };
}

// 地类只显示水田（ADR 0173）
const FILTERED = withFilters({ bgdc_dltb: { [CLASS_FIELD]: ['0101'] } });

const UNIFORM: ResourceSymbolOverride = { mode: 'uniform', uniform: { fillColor: '#ff0000' } };
const NONE: ReadonlyMap<string, unknown> = new Map();
const noOverride: SymbolOverrideOf = () => undefined;
const codes = (items: readonly { readonly resource: { readonly code: string } }[]) =>
  items.map(({ resource }) => resource.code);

// 整屏查询的假视图：按数据源给出要素，记下每次查询
function fakeView(features: Readonly<Record<string, readonly RenderedFeature[]>>, sky = false) {
  const queries: { readonly area: ScreenPoint | ScreenBox; readonly options: RenderedQueryOptions }[] = [];
  const view = {
    queryRendered: (area: ScreenPoint | ScreenBox, options: RenderedQueryOptions) => {
      queries.push({ area, options });
      return options.sources.flatMap(source => features[source] ?? []);
    },
    // 画面 1440 × 800 对着东经 117～122、北纬 30～35；sky 时上面两角是天空（三维）
    pick: ({ x, y }: ScreenPoint): PickResult =>
      sky && y === 0
        ? { kind: 'miss' }
        : { kind: 'hit', surface: 'map', lngLat: [117 + (x * 5) / 1440, 35 - (y * 5) / 800] }
  };
  return { view, queries };
}

const feature = (sourceId: string, properties: Record<string, unknown>, geometry?: RenderedFeature['geometry']) => ({
  sourceId,
  layerId: sourceId,
  properties,
  ...(geometry ? { geometry } : {})
});

const point = (lng: number, lat: number) => ({ type: 'Point' as const, coordinates: [lng, lat] });

// 西南角在 (lng, lat)、边长 size 度的方块
const square = (lng: number, lat: number, size: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat]
    ]
  ]
});

// 东经 118～119、北纬 31～32 的区划，整个在画面里
const SQUARE = square(118, 31, 1);

// 地类图斑里 0.01 度见方的一块
const parcel = (dlbm: string, lng: number, lat: number) =>
  feature('resources-bgdc_dltb', { dlbm }, square(lng, lat, 0.01));

const SIZE = { width: 1440, height: 800 };

// 学校点的一个取值在字典里的名称
function schoolLabel(key: string): string | undefined {
  const rule = resourceStyle('csxhjctb_xxp').color;
  return (rule ? classItems(rule) : []).find(item => item.key === key)?.label;
}

describe('printedResources', () => {
  it('画在地图上、当前级别显示、没被校验拦下、看得见的资源，从上到下', () => {
    expect(codes(printedResources(STATE, NONE, 12))).toStrictEqual(['bgdc_dltb', 'csxhjctb_xxp']);
    expect(codes(printedResources(STATE, NONE, 13))).toStrictEqual(['bgdc_dltb', 'csxhjctb_xxp', 'test_farmland']);
    expect(codes(printedResources(STATE, new Map([['csxhjctb_xxp', ['字段不对']]]), 13))).toStrictEqual([
      'bgdc_dltb',
      'test_farmland'
    ]);
  });
});

describe('renderedClasses', () => {
  const INPUT = { state: STATE, invalid: NONE, overrideOf: noOverride, size: SIZE };
  const FEATURES = {
    'resources-bgdc_dltb': [
      feature('resources-bgdc_dltb', { dlbm: '0101' }),
      feature('resources-bgdc_dltb', { dlbm: '0101' }),
      feature('resources-bgdc_dltb', { dlbm: '1101' }),
      feature('resources-bgdc_dltb', { dlbm: '9999', dlmc: '对不上' })
    ],
    'resources-csxhjctb_xxp': [feature('resources-csxhjctb_xxp', { cc: '08H213' })],
    'resources-test_farmland': []
  };

  it('整屏查一次各资源画出来的要素，按图层同一个 match 求出取值；统一符号的是空集合，没画出要素的不在里面', () => {
    const { view, queries } = fakeView({
      ...FEATURES,
      'resources-test_farmland': [feature('resources-test_farmland', { guid: 'a' })]
    });

    const rendered = renderedClasses({
      view,
      state: STATE,
      invalid: NONE,
      overrideOf: noOverride,
      zoom: 13,
      size: SIZE,
      scope: null
    });

    expect(rendered).toStrictEqual(
      new Map([
        ['bgdc_dltb', new Set(['0101', '1101', OTHER_ITEM])],
        ['csxhjctb_xxp', new Set(['08H213'])],
        ['test_farmland', new Set()]
      ])
    );
    expect(queries).toStrictEqual(
      ['resources-bgdc_dltb', 'resources-csxhjctb_xxp', 'resources-test_farmland'].map(source => ({
        area: { from: { x: 0, y: 0 }, to: { x: 1440, y: 800 } },
        options: { sources: [source], withGeometry: false }
      }))
    );

    const { view: empty } = fakeView(FEATURES);
    const without = renderedClasses({
      view: empty,
      state: STATE,
      invalid: NONE,
      overrideOf: noOverride,
      zoom: 13,
      size: SIZE,
      scope: null
    });
    expect(without.has('test_farmland')).toBe(false);
  });

  it('统一样式的分类资源没有取值', () => {
    const { view } = fakeView(FEATURES);
    const uniform: ResourceSymbolOverride = { mode: 'uniform', uniform: { fillColor: '#ff0000' } };

    const rendered = renderedClasses({
      view,
      state: STATE,
      invalid: NONE,
      overrideOf: code => (code === 'bgdc_dltb' ? uniform : undefined),
      zoom: 12,
      size: SIZE,
      scope: null
    });

    expect(rendered.get('bgdc_dltb')).toStrictEqual(new Set());
  });

  it('有区划范围时带几何查询，只算范围里的要素（同点选、框选）', () => {
    const { view, queries } = fakeView({
      'resources-bgdc_dltb': [
        feature('resources-bgdc_dltb', { dlbm: '0101' }, point(118.5, 31.5)),
        feature('resources-bgdc_dltb', { dlbm: '1101' }, point(120, 33))
      ],
      'resources-csxhjctb_xxp': [feature('resources-csxhjctb_xxp', { cc: '08H213' }, point(121, 31.5))]
    });

    const rendered = renderedClasses({
      view,
      state: STATE,
      invalid: NONE,
      overrideOf: noOverride,
      zoom: 12,
      size: SIZE,
      scope: SQUARE
    });

    expect(rendered).toStrictEqual(new Map([['bgdc_dltb', new Set(['0101'])]]));
    expect(queries.every(({ options }) => options.withGeometry)).toBe(true);
  });

  it('区划整个在画面里时不裁区划（精确裁剪整个区划要近 200 毫秒），要素直接和区划求交', () => {
    const { view } = fakeView({
      'resources-bgdc_dltb': [
        feature('resources-bgdc_dltb', { dlbm: '0101' }, point(118.5, 31.5)),
        feature('resources-bgdc_dltb', { dlbm: '1101' }, point(120, 33))
      ]
    });
    resetCalls();

    const rendered = renderedClasses({ ...INPUT, view, zoom: 12, scope: SQUARE });

    expect(rendered).toStrictEqual(new Map([['bgdc_dltb', new Set(['0101'])]]));
    expect(calls.clips).toBe(0);
    expect(calls.intersections).toStrictEqual([5, 5]);
  });

  it('区划边界很长、画面里只有一段边界时，先把区划裁到画面里再求交，已有的取值不再求交', () => {
    // 1 万个顶点的大圆：圆心 (108, 32.5)、半径 10 度，只有东边一小段边界在画面里（同放大到区划边缘附近）；
    // 要素是 0.01 度的小方块，范围里的在东经 117.3，区划外的在东经 119.5 以东
    const ring = Array.from({ length: 10_000 }, (_, index) => {
      const angle = (index / 10_000) * Math.PI * 2;
      return [108 + 10 * Math.cos(angle), 32.5 + 10 * Math.sin(angle)];
    });
    const scope: Polygon = { type: 'Polygon', coordinates: [[...ring, ring[0] ?? [0, 0]]] };
    const inside = Array.from({ length: 50 }, (_, index) => parcel(index % 2 === 0 ? '0101' : '1101', 117.3, 32.5));
    const outside = Array.from({ length: 400 }, (_, index) => parcel('0301', 119.5 + (index % 20) * 0.05, 32.2));
    const { view } = fakeView({ 'resources-bgdc_dltb': [...inside, ...outside] });
    resetCalls();

    const rendered = renderedClasses({ ...INPUT, view, zoom: 12, scope });

    expect(rendered).toStrictEqual(new Map([['bgdc_dltb', new Set(['0101', '1101'])]]));
    // 范围里的两种取值各求交一次，区划外的每个都要求交，但对着的是裁过的区划，不是 1 万个顶点
    expect(calls.clips).toBe(1);
    expect(calls.intersections).toHaveLength(2 + outside.length);
    expect(Math.max(...calls.intersections)).toBeLessThan(1000);
  });

  it('三维里画面有一角是天空时，按查到的要素的外包矩形裁区划；统一符号的资源找到一个范围里的就停', () => {
    const { view } = fakeView(
      {
        'resources-test_farmland': [
          feature('resources-test_farmland', { guid: 'a' }, point(118.5, 31.5)),
          feature('resources-test_farmland', { guid: 'b' }, point(118.6, 31.6)),
          feature('resources-test_farmland', { guid: 'c' }, point(120.5, 33))
        ]
      },
      true
    );
    resetCalls();

    const rendered = renderedClasses({ ...INPUT, view, zoom: 13, scope: SQUARE });

    expect(rendered).toStrictEqual(new Map([['test_farmland', new Set()]]));
    expect(calls.clips).toBe(1);
    expect(calls.intersections).toHaveLength(1);
  });

  it('区划整个在画面外时没有资源', () => {
    const { view } = fakeView({
      'resources-bgdc_dltb': [feature('resources-bgdc_dltb', { dlbm: '0101' }, point(118.5, 31.5))]
    });

    const rendered = renderedClasses({ ...INPUT, view, zoom: 12, scope: square(125, 40, 1) });

    expect(rendered.size).toBe(0);
  });
});

describe('printEntries', () => {
  const INPUT = { state: STATE, invalid: NONE, overrideOf: noOverride, zoom: 13 };
  const RENDERED: RenderedClasses = new Map([
    ['bgdc_dltb', new Set(['1101', '0101', OTHER_ITEM])],
    ['csxhjctb_xxp', new Set(['08H213', '不在登记里'])],
    ['test_farmland', new Set()]
  ]);
  it('只列画面里画出来的资源和取值，次序同右侧图例；名称带年份，透明度随资源', () => {
    const entries = printEntries(INPUT, RENDERED);

    expect(entries.map(({ kind, code, title, opacity }) => ({ kind, code, title, opacity }))).toStrictEqual([
      { kind: 'classes', code: 'bgdc_dltb', title: '地类图斑（2022）', opacity: 0.6 },
      { kind: 'classes', code: 'csxhjctb_xxp', title: '学校点层（2025）', opacity: 1 },
      { kind: 'symbol', code: 'test_farmland', title: '永久基本农田（2023）', opacity: 1 }
    ]);
    const [landuse, schools] = entries;
    expect(landuse?.kind === 'classes' && landuse.items.map(item => item.label)).toStrictEqual([
      '0101 水田',
      '1101 河流水面',
      '未匹配的地类'
    ]);
    expect(landuse?.kind === 'classes' && landuse.continued).toBe('地类图斑（2022，续）');
    expect(schools?.kind === 'classes' && schools.items.map(item => item.label)).toStrictEqual([schoolLabel('08H213')]);
  });

  it('没画出来的资源不列；统一样式的分类资源是一行', () => {
    const entries = printEntries(
      { ...INPUT, overrideOf: code => (code === 'bgdc_dltb' ? UNIFORM : undefined) },
      new Map([['bgdc_dltb', new Set()]])
    );

    expect(entries).toMatchObject([
      { kind: 'symbol', code: 'bgdc_dltb', swatch: { geometry: 'fill', fill: '#ff0000' } }
    ]);
  });

  it('按分类过滤时类别只列勾着的、画面里出现的（同右侧图例，ADR 0173）', () => {
    const [landuse] = printEntries({ ...INPUT, state: FILTERED }, RENDERED);

    expect(landuse?.kind === 'classes' && landuse.items.map(item => item.key)).toStrictEqual(['0101']);
  });
});

describe('resourcePrintBlocks', () => {
  it('统一符号是没有标题的一行，按属性配色的是一组，跨列时用续的标题', () => {
    const entries = printEntries({ state: STATE, invalid: NONE, overrideOf: noOverride, zoom: 13 }, new Map([
      ['bgdc_dltb', new Set(['0101'])],
      ['test_farmland', new Set()]
    ]));

    const blocks = resourcePrintBlocks(entries);

    const shown = blocks.map(({ title, continued, rows }) => ({
      title,
      continued,
      labels: rows.map(row => row.label)
    }));
    expect(shown).toStrictEqual([
      { title: '地类图斑（2022）', continued: '地类图斑（2022，续）', labels: ['0101 水田'] },
      { title: null, continued: undefined, labels: ['永久基本农田（2023）'] }
    ]);
  });

  it('没有资源时没有组', () => {
    expect(resourcePrintBlocks([] as PrintEntry[])).toStrictEqual([]);
  });
});
