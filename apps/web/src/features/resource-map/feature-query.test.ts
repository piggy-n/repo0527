// @vitest-environment node
import type { Geometry, LineString, Point } from 'geojson';
import type { LngLat, PickResult, RenderedFeature, RenderedQueryOptions, ScreenBox, ScreenPoint } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import type { ResourceTreeCategory, ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import {
  featureBounds,
  featureRows,
  featureSummary,
  identifyGeometry,
  identifyStep,
  pickResources,
  planIdentify,
  type PickCandidate,
  type PickResource,
  queryCapabilityOf,
  renderedCandidates,
  screenDistance,
  serverCandidates
} from './feature-query';
import type { ResourceDisplay, ResourceLayersState } from './resource-layers';

function layer(code: string, geoType: ResourceTreeLayer['geoType'], ...yearList: [number, ...number[]]) {
  return { code, name: `${code} 的名称`, geoType, yearList };
}

const tree: ResourceTreeCategory[] = [
  {
    code: null,
    name: '测试',
    children: [
      layer('bgdc_dltb', 'Polygon', 2022),
      layer('bgdc_dltb_czc', 'Polygon', 2022),
      // 9 级起显示
      layer('bgdc_cjdcq', 'Polygon', 2023, 2024),
      layer('csxhjctb_hydl', 'Line', 2023, 2024, 2025),
      layer('csxhjctb_gyssp', 'Point', 2025),
      layer('szy_kt', 'Polygon', 2025)
    ]
  }
];
const CATALOG = buildCatalog(tree);

const display = (year: number, checked = true): ResourceDisplay => ({ checked, opacity: 1, year });

// 从上到下：水域线、村级调查区、地类图斑、坑塘（没勾选）、公用设施点
const STATE: ResourceLayersState = {
  catalog: CATALOG,
  displays: new Map([
    ['csxhjctb_hydl', display(2024)],
    ['bgdc_cjdcq', display(2023)],
    ['bgdc_dltb', display(2022)],
    ['szy_kt', display(2025, false)],
    ['csxhjctb_gyssp', display(2025)]
  ]),
  order: ['csxhjctb_hydl', 'bgdc_cjdcq', 'bgdc_dltb', 'szy_kt', 'csxhjctb_gyssp']
};

function targetOf(code: string, year: number): PickResource {
  const resource = CATALOG.resources.get(code);
  if (!resource) {
    throw new Error(`测试目录里没有 ${code}`);
  }
  return { resource, year, sourceId: `resources-${code}`, layerCode: `${code}_${year}` };
}

const DLTB = targetOf('bgdc_dltb', 2022);
const HYDL = targetOf('csxhjctb_hydl', 2024);

const guid = (digit: string) => digit.repeat(32);

describe('queryCapabilityOf', () => {
  it('按数据集前缀：bgdc_ 能识别、能查详情，csxhjctb_ 只能查详情，其他都不能', () => {
    expect(queryCapabilityOf('bgdc_dltb')).toStrictEqual({ identify: true, detail: true });
    expect(queryCapabilityOf('csxhjctb_hydl')).toStrictEqual({ identify: false, detail: true });
    for (const code of ['szy_kt', 'lcsh_gyl', 'gtkjgh_czkfbj', 'xbgdc_dltb']) {
      expect(queryCapabilityOf(code)).toStrictEqual({ identify: false, detail: false });
    }
  });
});

describe('pickResources', () => {
  it('从上到下取勾选的、当前级别显示的、没被校验拦下的；图层编码带所选的年份', () => {
    const invalid = new Map([['csxhjctb_gyssp', '图层不合法']]);

    expect(pickResources(STATE, invalid, 9)).toStrictEqual([HYDL, targetOf('bgdc_cjdcq', 2023), DLTB]);
    expect(pickResources(STATE, invalid, 8.9).map(target => target.resource.code)).toStrictEqual([
      'csxhjctb_hydl',
      'bgdc_dltb'
    ]);
    expect(pickResources(STATE, new Map(), 8).map(target => target.layerCode)).toStrictEqual([
      'csxhjctb_hydl_2024',
      'bgdc_dltb_2022',
      'csxhjctb_gyssp_2025'
    ]);
  });

  it('目录还没加载、顺序里的资源不在目录或没有显示状态时跳过', () => {
    expect(pickResources({ ...STATE, catalog: null }, new Map(), 12)).toStrictEqual([]);
    const order = ['bgdc_xzq', 'bgdc_dltb_czc', ...STATE.order];
    expect(pickResources({ ...STATE, order }, new Map(), 8).map(target => target.resource.code)).toStrictEqual([
      'csxhjctb_hydl',
      'bgdc_dltb',
      'csxhjctb_gyssp'
    ]);
  });
});

// 渲染要素：几何用一个点表示到点击位置的距离
function rendered(sourceId: string, properties: Record<string, unknown>, distance?: number): RenderedFeature {
  const geometry: Point | undefined =
    distance === undefined ? undefined : { type: 'Point', coordinates: [distance, 0] };
  return { sourceId, layerId: sourceId, properties, geometry };
}

const distanceOf = (geometry: Geometry | undefined) =>
  geometry?.type === 'Point' ? (geometry.coordinates[0] ?? Infinity) : Infinity;

const summaryOf = (candidates: readonly PickCandidate[]) =>
  candidates.map(({ guid: id, origin, distance, properties }) => [id[0], origin, distance, properties.name]);

describe('renderedCandidates', () => {
  it('只取这个数据源有 guid 的要素，按 guid 去重留下最近的，按距离排序、同样近的保持从上到下', () => {
    const features = [
      rendered(HYDL.sourceId, { guid: guid('b'), name: 'b' }, 2),
      rendered(HYDL.sourceId, { guid: guid('a'), name: 'a 远处的一段' }, 6),
      rendered(HYDL.sourceId, { guid: guid('c'), name: 'c' }, 2),
      rendered(HYDL.sourceId, { guid: guid('a'), name: 'a 近处的一段' }, 1),
      rendered(HYDL.sourceId, { guid: guid('d'), name: 'd 没有几何' }),
      rendered(HYDL.sourceId, { guid: guid('A'), name: '大写的不是 guid' }, 0),
      rendered(HYDL.sourceId, { name: '没有 guid' }, 0),
      rendered(DLTB.sourceId, { guid: guid('e'), name: '别的数据源' }, 0)
    ];

    const candidates = renderedCandidates(HYDL, features, distanceOf);

    expect(summaryOf(candidates)).toStrictEqual([
      ['a', 'rendered', 1, 'a 近处的一段'],
      ['b', 'rendered', 2, 'b'],
      ['c', 'rendered', 2, 'c'],
      ['d', 'rendered', Infinity, 'd 没有几何']
    ]);
    expect(candidates[0]?.key).toBe(JSON.stringify([HYDL.sourceId, guid('a')]));
    expect(candidates[0]?.target).toBe(HYDL);
  });

  it('同一个 guid 一样近时留下先出现的（画在上面的）', () => {
    const features = [
      rendered(HYDL.sourceId, { guid: guid('a'), name: '上面的图层' }, 3),
      rendered(HYDL.sourceId, { guid: guid('a'), name: '下面的图层' }, 3)
    ];

    expect(summaryOf(renderedCandidates(HYDL, features, distanceOf))).toStrictEqual([
      ['a', 'rendered', 3, '上面的图层']
    ]);
  });
});

describe('serverCandidates', () => {
  it('按返回的顺序，没有 guid 的不算、重复的只留第一条，距离记为 0', () => {
    const records = [
      { guid: guid('b'), name: 'b' },
      { guid: null, name: '没有 guid' },
      { guid: guid('a'), name: 'a' },
      { guid: guid('b'), name: 'b 重复' }
    ];

    const candidates = serverCandidates(DLTB, records);

    expect(summaryOf(candidates)).toStrictEqual([
      ['b', 'server', 0, 'b'],
      ['a', 'server', 0, 'a']
    ]);
    expect(candidates[1]?.key).toBe(JSON.stringify([DLTB.sourceId, guid('a')]));
  });
});

describe('identifyStep', () => {
  const both = { identify: true, detail: true };
  const detailOnly = { identify: false, detail: true };
  const found = renderedCandidates(DLTB, [rendered(DLTB.sourceId, { guid: guid('a') }, 0)], distanceOf);

  it('14 级及以上有渲染要素时直接用它', () => {
    expect(identifyStep(both, 14, found)).toStrictEqual({ kind: 'rendered', candidates: found });
  });

  it('级别不够或没有渲染要素时，能做后端识别的查后端', () => {
    expect(identifyStep(both, 13.9, found)).toStrictEqual({ kind: 'server' });
    expect(identifyStep(both, 16, [])).toStrictEqual({ kind: 'server' });
  });

  it('不能做后端识别时有渲染要素就用，没有就没有结果', () => {
    expect(identifyStep(detailOnly, 10, found)).toStrictEqual({ kind: 'rendered', candidates: found });
    expect(identifyStep(detailOnly, 16, [])).toStrictEqual({ kind: 'none' });
  });
});

// 屏幕坐标的百分之一作经纬度，记下拾取过的点
function picker(miss: (point: ScreenPoint) => boolean = () => false) {
  const picked: ScreenPoint[] = [];
  const pick = (point: ScreenPoint): PickResult => {
    picked.push(point);
    return miss(point) ? { kind: 'miss' } : { kind: 'hit', surface: 'map', lngLat: [point.x / 100, point.y / 100] };
  };
  return { pick, picked };
}

describe('identifyGeometry', () => {
  it('面用点击位置的点', () => {
    const { pick, picked } = picker();

    expect(identifyGeometry('fill', { x: 300, y: 200 }, pick)).toStrictEqual({ type: 'Point', coordinates: [3, 2] });
    expect(picked).toStrictEqual([{ x: 300, y: 200 }]);
  });

  it('线、点用容差框四角拾取到的闭合多边形：线 8 像素，点 10 像素', () => {
    expect(identifyGeometry('line', { x: 300, y: 200 }, picker().pick)).toStrictEqual({
      type: 'Polygon',
      coordinates: [
        [
          [2.92, 1.92],
          [3.08, 1.92],
          [3.08, 2.08],
          [2.92, 2.08],
          [2.92, 1.92]
        ]
      ]
    });
    expect(identifyGeometry('circle', { x: 300, y: 200 }, picker().pick)).toStrictEqual({
      type: 'Polygon',
      coordinates: [
        [
          [2.9, 1.9],
          [3.1, 1.9],
          [3.1, 2.1],
          [2.9, 2.1],
          [2.9, 1.9]
        ]
      ]
    });
  });

  it('拾取不到点击位置或任何一角时为 null', () => {
    expect(identifyGeometry('fill', { x: 300, y: 200 }, picker(() => true).pick)).toBeNull();
    const missCorner = picker(({ x, y }) => x === 308 && y === 208);
    expect(identifyGeometry('line', { x: 300, y: 200 }, missCorner.pick)).toBeNull();
  });
});

// 经纬度原样当作屏幕坐标；纬度为 99 的位置投影不到
const project = ([x, y]: LngLat): ScreenPoint | null => (y === 99 ? null : { x, y });

const line = (...coordinates: [number, number][]): LineString => ({ type: 'LineString', coordinates });

describe('screenDistance', () => {
  const ORIGIN = { x: 0, y: 0 };

  it('没有几何时为无穷大，面为 0', () => {
    expect(screenDistance(undefined, ORIGIN, project)).toBe(Infinity);
    const far = { type: 'Polygon', coordinates: [[[50, 50], [60, 50], [60, 60], [50, 50]]] } satisfies Geometry;
    expect(screenDistance(far, ORIGIN, project)).toBe(0);
    expect(screenDistance({ type: 'MultiPolygon', coordinates: [far.coordinates] }, ORIGIN, project)).toBe(0);
  });

  it('点取到点的距离，多点取最近的；投影不到的点为无穷大', () => {
    expect(screenDistance({ type: 'Point', coordinates: [3, 4] }, ORIGIN, project)).toBe(5);
    const points = { type: 'MultiPoint', coordinates: [[30, 40], [0, 99], [-6, 8]] } satisfies Geometry;
    expect(screenDistance(points, ORIGIN, project)).toBe(10);
    expect(screenDistance({ type: 'Point', coordinates: [0, 99] }, ORIGIN, project)).toBe(Infinity);
  });

  it('线取到各线段的最短距离：垂足落在线段外时取到端点的距离，长度为 0 的线段取到端点的距离', () => {
    expect(screenDistance(line([-10, 3], [10, 3]), ORIGIN, project)).toBe(3);
    expect(screenDistance(line([20, 20], [5, 0], [10, 0]), ORIGIN, project)).toBe(5);
    expect(screenDistance(line([10, 0], [5, 0]), ORIGIN, project)).toBe(5);
    expect(screenDistance(line([6, 8], [6, 8]), ORIGIN, project)).toBe(10);
  });

  it('线上投影不到的点所在的线段不算；多线、几何集合取最近的部分', () => {
    expect(screenDistance(line([-10, 1], [0, 99], [10, 1], [10, 5], [-10, 5]), ORIGIN, project)).toBe(5);
    expect(screenDistance(line([-10, 1], [0, 99]), ORIGIN, project)).toBe(Infinity);
    const lines = {
      type: 'MultiLineString',
      coordinates: [
        [[-10, 7], [10, 7]],
        [[-10, -2], [10, -2]]
      ]
    } satisfies Geometry;
    expect(screenDistance(lines, ORIGIN, project)).toBe(2);
    const collection = {
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [0, 4] }, line([-10, 3], [10, 3])]
    } satisfies Geometry;
    expect(screenDistance(collection, ORIGIN, project)).toBe(3);
  });
});

// 渲染要素的查询记下范围和选项，按数据源返回给定的要素；拾取同 picker，项目同 project
function fakeView(features: readonly RenderedFeature[], miss = false) {
  const queries: [ScreenPoint | ScreenBox, RenderedQueryOptions][] = [];
  const view = {
    pick: picker(() => miss).pick,
    project,
    queryRendered: (area: ScreenPoint | ScreenBox, options: RenderedQueryOptions) => {
      queries.push([area, options]);
      return features.filter(({ sourceId }) => options.sources.includes(sourceId));
    }
  };
  return { view, queries };
}

const SZY = targetOf('szy_kt', 2025);

const kindsOf = (tasks: ReturnType<typeof planIdentify>) => tasks.map(task => [task.target.resource.code, task.kind]);

describe('planIdentify', () => {
  const ORIGIN = { x: 0, y: 0 };
  const features = [
    rendered(HYDL.sourceId, { guid: guid('a') }, 5),
    rendered(HYDL.sourceId, { guid: guid('b') }, 2),
    rendered(DLTB.sourceId, { guid: guid('c') }, 0)
  ];

  it('渲染要素按几何类型取：面取点击位置、不换算几何，线、点取容差框并换算几何', () => {
    const { view, queries } = fakeView(features);

    planIdentify([HYDL, DLTB, SZY], ORIGIN, 15, view);

    expect(queries).toStrictEqual([
      [{ from: { x: -8, y: -8 }, to: { x: 8, y: 8 } }, { sources: [HYDL.sourceId], withGeometry: true }],
      [ORIGIN, { sources: [DLTB.sourceId], withGeometry: false }],
      [ORIGIN, { sources: [SZY.sourceId], withGeometry: false }]
    ]);
  });

  it('14 级起有渲染要素的都用渲染要素，候选按屏幕距离排序；什么也没有的资源不在结果里', () => {
    const tasks = planIdentify([HYDL, DLTB, SZY], ORIGIN, 15, fakeView(features).view);

    expect(kindsOf(tasks)).toStrictEqual([
      ['csxhjctb_hydl', 'rendered'],
      ['bgdc_dltb', 'rendered']
    ]);
    const [first] = tasks;
    const order = first?.kind === 'rendered' ? first.candidates.map(({ guid: id }) => id) : [];
    expect(order).toStrictEqual([guid('b'), guid('a')]);
  });

  it('级别不够时能识别的资源查后端，面用点击位置；不能识别的有渲染要素就用', () => {
    const tasks = planIdentify([HYDL, DLTB, SZY], ORIGIN, 12, fakeView(features).view);

    expect(kindsOf(tasks)).toStrictEqual([
      ['csxhjctb_hydl', 'rendered'],
      ['bgdc_dltb', 'server']
    ]);
    expect(tasks[1]).toStrictEqual({ kind: 'server', target: DLTB, geometry: { type: 'Point', coordinates: [0, 0] } });
  });

  it('14 级起没有渲染要素时也查后端；拾取不到范围时退回渲染要素，没有就不在结果里', () => {
    expect(kindsOf(planIdentify([DLTB], ORIGIN, 16, fakeView([]).view))).toStrictEqual([['bgdc_dltb', 'server']]);
    expect(kindsOf(planIdentify([DLTB], ORIGIN, 12, fakeView(features, true).view))).toStrictEqual([
      ['bgdc_dltb', 'rendered']
    ]);
    expect(planIdentify([DLTB], ORIGIN, 12, fakeView([], true).view)).toStrictEqual([]);
  });
});

describe('featureBounds', () => {
  it('几何的外包范围：西、南、东、北', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [119, 33],
          [119.2, 33.05],
          [119.1, 33.3],
          [119, 33]
        ]
      ]
    } satisfies Geometry;
    expect(featureBounds(polygon)).toStrictEqual([119, 33, 119.2, 33.3]);
    expect(featureBounds({ type: 'Point', coordinates: [120.5, 32.1] })).toStrictEqual([120.5, 32.1, 120.5, 32.1]);
  });
});

describe('featureSummary', () => {
  it('标题是资源名，副标题是年份和名称：地类（编码、名称配色）取地类名称', () => {
    const properties = { dlmc: '水田', name: '不用的名称' };

    expect(featureSummary(DLTB, properties)).toStrictEqual({ title: 'bgdc_dltb 的名称', subtitle: '2022 · 水田' });
    expect(featureSummary(targetOf('bgdc_dltb_czc', 2022), properties).subtitle).toBe('2022 · 水田');
  });

  it('其他资源取 name；没有名称或名称为空时只有年份，数字照常显示', () => {
    expect(featureSummary(HYDL, { name: '某河', dlmc: '河流水面' }).subtitle).toBe('2024 · 某河');
    expect(featureSummary(HYDL, { name: 42 }).subtitle).toBe('2024 · 42');
    expect(featureSummary(HYDL, { name: '' }).subtitle).toBe('2024');
    expect(featureSummary(HYDL, { name: { text: '某河' } }).subtitle).toBe('2024');
    expect(featureSummary(DLTB, {}).subtitle).toBe('2022');
  });
});

describe('featureRows', () => {
  const properties = {
    guid: guid('a'),
    bsm: '320826211000006380',
    DLMC: '水田',
    tbmj: 6033.8398,
    GEOM: '{"type":"Point"}',
    geometry: null,
    bz: null,
    kcxs: '',
    sfjz: false,
    extra: { a: 1 }
  };

  it('按返回的顺序，不列主键和几何；地类的字段名用中文名（大小写不敏感），不认识的用字段编码', () => {
    expect(featureRows('bgdc_dltb', properties)).toStrictEqual([
      { key: 'bsm', label: '标识码', value: '320826211000006380' },
      { key: 'DLMC', label: '地类名称', value: '水田' },
      { key: 'tbmj', label: '图斑面积', value: '6033.8398' },
      { key: 'bz', label: '备注', value: '-' },
      { key: 'kcxs', label: '扣除地类系数', value: '-' },
      { key: 'sfjz', label: 'sfjz', value: 'false' },
      { key: 'extra', label: 'extra', value: '{"a":1}' }
    ]);
  });

  it('其他资源的字段名都用字段编码', () => {
    expect(featureRows('csxhjctb_hydl', properties).map(row => row.label)).toStrictEqual([
      'bsm',
      'DLMC',
      'tbmj',
      'bz',
      'kcxs',
      'sfjz',
      'extra'
    ]);
  });
});
