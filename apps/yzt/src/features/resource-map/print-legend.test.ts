import type { RenderedFeature, RenderedQueryOptions, ScreenBox, ScreenPoint } from '@mx/map-core';
import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog';
import { classItems, OTHER_ITEM } from './classification';
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
const NONE: ReadonlyMap<string, unknown> = new Map();
const noOverride: SymbolOverrideOf = () => undefined;
const codes = (items: readonly { readonly resource: { readonly code: string } }[]) =>
  items.map(({ resource }) => resource.code);

// 整屏查询的假视图：按数据源给出要素，记下每次查询
function fakeView(features: Readonly<Record<string, readonly RenderedFeature[]>>) {
  const queries: { readonly area: ScreenPoint | ScreenBox; readonly options: RenderedQueryOptions }[] = [];
  const view = {
    queryRendered: (area: ScreenPoint | ScreenBox, options: RenderedQueryOptions) => {
      queries.push({ area, options });
      return options.sources.flatMap(source => features[source] ?? []);
    }
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
    const scope: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [118, 31],
          [119, 31],
          [119, 32],
          [118, 32],
          [118, 31]
        ]
      ]
    };
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
      scope
    });

    expect(rendered).toStrictEqual(new Map([['bgdc_dltb', new Set(['0101'])]]));
    expect(queries.every(({ options }) => options.withGeometry)).toBe(true);
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
    const uniform: ResourceSymbolOverride = { mode: 'uniform', uniform: { fillColor: '#ff0000' } };
    const entries = printEntries(
      { ...INPUT, overrideOf: code => (code === 'bgdc_dltb' ? uniform : undefined) },
      new Map([['bgdc_dltb', new Set()]])
    );

    expect(entries).toMatchObject([
      { kind: 'symbol', code: 'bgdc_dltb', swatch: { geometry: 'fill', fill: '#ff0000' } }
    ]);
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
