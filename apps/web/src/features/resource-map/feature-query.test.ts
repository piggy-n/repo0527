// @vitest-environment node
import { bbox } from '@turf/bbox';
import type { Geometry, LineString, Point, Polygon, Position } from 'geojson';
import type {
  LngLat,
  PickResult,
  RenderedFeature,
  RenderedQueryOptions,
  ScreenBox,
  ScreenPoint,
  ViewKind
} from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { isValidPolygonal, QUERY_VERTEX_LIMIT, screenBoxPolygon, vertexCount } from '@/shared/map/query-geometry';
import type { RegionScope } from '@/shared/map/region/region-scope';
import type { ResourceTreeCategory, ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import {
  BOX_ESTIMATE_LIMIT,
  type BoxTask,
  featureBounds,
  featureLabel,
  featureRows,
  identifyGeometry,
  identifyStep,
  isEmptyValue,
  pickResources,
  planBox,
  planIdentify,
  type PickCandidate,
  type PickResource,
  queryCapabilityOf,
  renderedCandidates,
  screenDistance,
  serverCandidates,
  weightedEstimate
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
      // 后端识别：乡村道路能，城市道路、村级调查区界线不能（ADR 0048 第 1 节）
      layer('csxhjctb_lvll', 'Line', 2025),
      layer('csxhjctb_lctl', 'Line', 2025),
      layer('bgdc_cjdcqjx', 'Line', 2022),
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
  it('后端范围识别逐个数据集登记，查详情按前缀，两者各自判断', () => {
    for (const code of ['bgdc_dltb', 'bgdc_dltb_czc', 'bgdc_czcdyd', 'csxhjctb_hydl', 'csxhjctb_lvll']) {
      expect(queryCapabilityOf(code)).toStrictEqual({ identify: true, detail: true });
    }
    // 没有登记的不做后端范围识别，前缀相同、名字更长的也不算
    for (const code of ['bgdc_cjdcqjx', 'bgdc_xzq', 'bgdc_dltbx', 'csxhjctb_lctl', 'csxhjctb_gyssp']) {
      expect(queryCapabilityOf(code)).toStrictEqual({ identify: false, detail: true });
    }
    for (const code of ['szy_kt', 'lcsh_lcshfbtb', 'gtkjgh_czkfbj', 'xbgdc_dltb']) {
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

  it('二维 14 级起只用渲染要素：有就用，没有就跳过，不查后端', () => {
    expect(identifyStep(both, '2d', 14, found)).toStrictEqual({ kind: 'rendered', candidates: found });
    expect(identifyStep(both, '2d', 14, [])).toStrictEqual({ kind: 'none' });
  });

  it('二维 14 级以下能后端识别的查后端，有渲染要素也查', () => {
    expect(identifyStep(both, '2d', 13.99, found)).toStrictEqual({ kind: 'server' });
    expect(identifyStep(both, '2d', 13.99, [])).toStrictEqual({ kind: 'server' });
  });

  it('三维没有渲染要素，不论级别，能后端识别的查后端', () => {
    expect(identifyStep(both, '3d', 16, [])).toStrictEqual({ kind: 'server' });
  });

  it('不能后端识别时有渲染要素就用，没有就没有结果', () => {
    expect(identifyStep(detailOnly, '2d', 10, found)).toStrictEqual({ kind: 'rendered', candidates: found });
    expect(identifyStep(detailOnly, '2d', 10, [])).toStrictEqual({ kind: 'none' });
    expect(identifyStep(detailOnly, '3d', 16, [])).toStrictEqual({ kind: 'none' });
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
function fakeView(
  features: readonly RenderedFeature[],
  { miss = false, kind = '2d' }: { readonly miss?: boolean; readonly kind?: ViewKind } = {}
) {
  const queries: [ScreenPoint | ScreenBox, RenderedQueryOptions][] = [];
  const view = {
    kind,
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
const LVLL = targetOf('csxhjctb_lvll', 2025);
const LCTL = targetOf('csxhjctb_lctl', 2025);
const CJDCQJX = targetOf('bgdc_cjdcqjx', 2022);

const kindsOf = (tasks: readonly BoxTask[]) => tasks.map(task => [task.target.resource.code, task.kind]);

describe('planIdentify', () => {
  const ORIGIN = { x: 0, y: 0 };
  const features = [
    rendered(LCTL.sourceId, { guid: guid('a') }, 5),
    rendered(LCTL.sourceId, { guid: guid('b') }, 2),
    rendered(HYDL.sourceId, { guid: guid('d') }, 1),
    rendered(CJDCQJX.sourceId, { guid: guid('e') }, 3),
    rendered(DLTB.sourceId, { guid: guid('c') }, 0)
  ];
  const parcelOnly = [rendered(DLTB.sourceId, { guid: guid('c') }, 0)];

  it('渲染要素按几何类型取：面取点击位置、不换算几何，线、点取容差框并换算几何', () => {
    const { view, queries } = fakeView([]);

    planIdentify([LCTL, DLTB, SZY], ORIGIN, 15, view);

    expect(queries).toStrictEqual([
      [{ from: { x: -8, y: -8 }, to: { x: 8, y: 8 } }, { sources: [LCTL.sourceId], withGeometry: true }],
      [ORIGIN, { sources: [DLTB.sourceId], withGeometry: false }],
      [ORIGIN, { sources: [SZY.sourceId], withGeometry: false }]
    ]);
  });

  it('二维 14 级起有渲染要素的用渲染要素，能后端识别的也不查；遇到第一个就停下，下面的资源不再查询；候选按屏幕距离排序', () => {
    const { view, queries } = fakeView(features);
    const tasks = planIdentify([HYDL, LCTL, DLTB, SZY], ORIGIN, 15, view);

    expect(kindsOf(tasks)).toStrictEqual([['csxhjctb_hydl', 'rendered']]);
    expect(queries.map(([, { sources }]) => sources)).toStrictEqual([[HYDL.sourceId]]);
    const [first] = planIdentify([LCTL, DLTB], ORIGIN, 15, view);
    const order = first?.kind === 'rendered' ? first.candidates.map(({ guid: id }) => id) : [];
    expect(order).toStrictEqual([guid('b'), guid('a')]);
  });

  it('二维 14 级起上面的资源没有渲染要素时跳过、只留下面的；全部没有时没有任务', () => {
    const lower = planIdentify([HYDL, LVLL, DLTB], ORIGIN, 14, fakeView(parcelOnly).view);

    expect(kindsOf(lower)).toStrictEqual([['bgdc_dltb', 'rendered']]);
    expect(planIdentify([HYDL, LVLL, DLTB], ORIGIN, 16, fakeView([]).view)).toStrictEqual([]);
  });

  it('14 级以下登记的数据集查后端：线用容差框、面用点击位置；没有登记的有渲染要素就用，用到时停下', () => {
    const tasks = planIdentify([HYDL, LVLL, DLTB, CJDCQJX, LCTL], ORIGIN, 13.99, fakeView(features).view);

    expect(kindsOf(tasks)).toStrictEqual([
      ['csxhjctb_hydl', 'server'],
      ['csxhjctb_lvll', 'server'],
      ['bgdc_dltb', 'server'],
      ['bgdc_cjdcqjx', 'rendered']
    ]);
    expect(tasks[0]).toMatchObject({ geometry: { type: 'Polygon' } });
    expect(tasks[2]).toStrictEqual({ kind: 'server', target: DLTB, geometry: { type: 'Point', coordinates: [0, 0] } });
  });

  it('三维没有渲染要素：能后端识别的资源仍查后端，其他的没有结果', () => {
    const tasks = planIdentify([LCTL, HYDL, DLTB, SZY], ORIGIN, 16, fakeView([], { kind: '3d' }).view);

    expect(kindsOf(tasks)).toStrictEqual([
      ['csxhjctb_hydl', 'server'],
      ['bgdc_dltb', 'server']
    ]);
  });

  it('拾取不到范围时退回渲染要素，没有就不在结果里', () => {
    const missed = planIdentify([DLTB], ORIGIN, 12, fakeView(parcelOnly, { miss: true }).view);

    expect(kindsOf(missed)).toStrictEqual([['bgdc_dltb', 'rendered']]);
    expect(planIdentify([DLTB], ORIGIN, 12, fakeView([], { miss: true }).view)).toStrictEqual([]);
  });
});

// n 个不同的 guid 的渲染要素
const many = (target: PickResource, n: number) =>
  Array.from({ length: n }, (_, index) => rendered(target.sourceId, { guid: index.toString(16).padStart(32, '0') }, 0));

describe('planBox', () => {
  const BOX = { from: { x: 0, y: 0 }, to: { x: 200, y: 100 } };

  it('二维 14 级起用框里的渲染要素：按 guid 去重、保持查询的顺序，不换算几何；有结果的资源下面不再查询', () => {
    const features = [
      rendered(DLTB.sourceId, { guid: guid('f') }, 0),
      rendered(DLTB.sourceId, { guid: guid('c') }, 0),
      rendered(DLTB.sourceId, { guid: guid('f') }, 0),
      rendered(SZY.sourceId, { guid: guid('d') }, 0)
    ];
    const { view, queries } = fakeView(features);

    const tasks = planBox([LCTL, DLTB, SZY], BOX, 15, view);

    expect(kindsOf(tasks)).toStrictEqual([['bgdc_dltb', 'rendered']]);
    const [task] = tasks;
    const order = task?.kind === 'rendered' ? task.candidates.map(({ guid: id }) => id) : [];
    expect(order).toStrictEqual([guid('f'), guid('c')]);
    expect(queries).toStrictEqual([
      [BOX, { sources: [LCTL.sourceId], withGeometry: false }],
      [BOX, { sources: [DLTB.sourceId], withGeometry: false }]
    ]);
  });

  it('14 级以下登记的数据集查后端（框的四角拾取成多边形）并继续看下面的资源，遇到渲染要素的结果停下', () => {
    const features = [
      rendered(CJDCQJX.sourceId, { guid: guid('e') }, 0),
      rendered(DLTB.sourceId, { guid: guid('c') }, 0)
    ];
    const { view, queries } = fakeView(features);

    const tasks = planBox([HYDL, CJDCQJX, DLTB], BOX, 13.99, view);

    expect(kindsOf(tasks)).toStrictEqual([
      ['csxhjctb_hydl', 'server'],
      ['bgdc_cjdcqjx', 'rendered']
    ]);
    expect(tasks[0]).toMatchObject({ geometry: screenBoxPolygon(BOX, picker().pick) });
    expect(queries).toHaveLength(2);
  });

  it('三维没有渲染要素：登记的数据集都查后端', () => {
    const tasks = planBox([HYDL, LCTL, DLTB], BOX, 16, fakeView([], { kind: '3d' }).view);

    expect(kindsOf(tasks)).toStrictEqual([
      ['csxhjctb_hydl', 'server'],
      ['bgdc_dltb', 'server']
    ]);
  });

  it('框里去重后超过 5000 个时停在这个资源，不查后端；恰好 5000 个、重复的照常', () => {
    const limit = BOX_ESTIMATE_LIMIT;
    // 超限的资源下面还有资源，也不再查询
    const crowded = [...many(DLTB, limit + 1), rendered(LCTL.sourceId, { guid: guid('a') }, 0)];
    expect(planBox([HYDL, DLTB, LCTL], BOX, 12, fakeView(crowded).view)).toStrictEqual([
      { kind: 'server', target: HYDL, geometry: screenBoxPolygon(BOX, picker().pick) },
      { kind: 'too-many', target: DLTB, estimate: limit + 1 }
    ]);

    const repeated = [...many(DLTB, limit), ...many(DLTB, 10)];
    expect(kindsOf(planBox([DLTB], BOX, 12, fakeView(repeated).view))).toStrictEqual([['bgdc_dltb', 'server']]);
    const [atLimit] = planBox([DLTB], BOX, 15, fakeView(repeated).view);
    expect(atLimit?.kind === 'rendered' && atLimit.candidates).toHaveLength(limit);
    // 只用渲染要素时按能列出的候选计数，超过上限同样停下
    expect(planBox([DLTB, LCTL], BOX, 15, fakeView(crowded).view)).toStrictEqual([
      { kind: 'too-many', target: DLTB, estimate: limit + 1 }
    ]);
  });

  it('拾取不到范围时退回渲染要素，没有就看下面的资源', () => {
    const missed = fakeView([rendered(LCTL.sourceId, { guid: guid('a') }, 0)], { miss: true }).view;

    expect(kindsOf(planBox([DLTB, LCTL], BOX, 12, missed))).toStrictEqual([['csxhjctb_lctl', 'rendered']]);
  });
});

// 资源某个样式图层里的渲染要素；suffix 是图层 ID 的后缀
function onLayer(target: PickResource, suffix: string | null, properties: Record<string, unknown>): RenderedFeature {
  const layerId = suffix ? `${target.sourceId}-${suffix}` : target.sourceId;
  return { sourceId: target.sourceId, layerId, properties };
}

const clusterOf = (count: unknown) => ({ bsm: '1', clustered: true, point_count: count });

describe('weightedEstimate', () => {
  it('带 guid 的去重，聚合要素按 point_count，其他不带 guid 的按个数，混在一起相加', () => {
    const features = [
      onLayer(DLTB, null, { guid: guid('a') }),
      onLayer(DLTB, null, { guid: guid('a') }),
      onLayer(DLTB, null, { guid: guid('b') }),
      onLayer(DLTB, null, clusterOf(20)),
      onLayer(DLTB, null, clusterOf(5)),
      onLayer(DLTB, null, { bsm: '2' }),
      onLayer(DLTB, null, { bsm: '3' })
    ];

    expect(weightedEstimate('bgdc_dltb', features)).toBe(2 + 25 + 2);
  });

  it('point_count 不是正数时按 1；不是聚合要素时 point_count 不算', () => {
    const features = [
      onLayer(DLTB, null, clusterOf(0)),
      onLayer(DLTB, null, clusterOf('20')),
      onLayer(DLTB, null, { clustered: false, point_count: 20 })
    ];

    expect(weightedEstimate('bgdc_dltb', features)).toBe(3);
  });

  it('只数画出要素本身的图层：加上纹理、描边层估数不变，聚合要素被几层返回时不重复累加', () => {
    const body = [onLayer(DLTB, null, clusterOf(20)), onLayer(DLTB, null, { bsm: '2' })];
    const styled = [
      ...body,
      onLayer(DLTB, 'pattern', clusterOf(20)),
      onLayer(DLTB, 'pattern', { bsm: '2' }),
      onLayer(DLTB, 'outline', clusterOf(20)),
      onLayer(DLTB, 'outline-dotted', { bsm: '2' })
    ];

    expect(weightedEstimate('bgdc_dltb', styled)).toBe(weightedEstimate('bgdc_dltb', body));
    expect(weightedEstimate('bgdc_dltb', body)).toBe(21);
  });

  it('线按线型拆到几层时每层的要素都算；别的资源的图层不算', () => {
    const lines = [onLayer(HYDL, null, {}), onLayer(HYDL, 'dashed', {}), onLayer(HYDL, 'dash-dot', {})];

    expect(weightedEstimate('csxhjctb_hydl', lines)).toBe(3);
    expect(weightedEstimate('bgdc_dltb', [onLayer(targetOf('bgdc_dltb_czc', 2022), null, {})])).toBe(0);
  });
});

// n 个不带 guid 的渲染要素
const guidless = (target: PickResource, n: number, suffix: string | null = null) =>
  Array.from({ length: n }, (_, index) => onLayer(target, suffix, { bsm: String(index) }));

describe('planBox：估数（ADR 0050）', () => {
  const BOX = { from: { x: 0, y: 0 }, to: { x: 200, y: 100 } };

  it('不能后端识别的上层资源有超过 5000 条不带 guid 的渲染要素时跳过，仍查询下面的资源', () => {
    const crowded = [...guidless(LCTL, BOX_ESTIMATE_LIMIT + 1), onLayer(DLTB, null, { guid: guid('c') })];

    expect(kindsOf(planBox([LCTL, DLTB], BOX, 12, fakeView(crowded).view))).toStrictEqual([['bgdc_dltb', 'server']]);
    expect(kindsOf(planBox([LCTL, DLTB], BOX, 15, fakeView(crowded).view))).toStrictEqual([['bgdc_dltb', 'rendered']]);
  });

  it('查后端的资源按加权估数：不带 guid 的聚合要素加起来超过 5000 时提示超限，不查后端', () => {
    const clusters = Array.from({ length: 60 }, () => onLayer(DLTB, null, clusterOf(100)));

    expect(planBox([DLTB], BOX, 12, fakeView(clusters).view)).toStrictEqual([
      { kind: 'too-many', target: DLTB, estimate: 6000 }
    ]);
  });

  it('同一批要素加上纹理、描边层后，估数不变，不会因为改了符号被拦下', () => {
    const styled = [...guidless(DLTB, 2000), ...guidless(DLTB, 2000, 'pattern'), ...guidless(DLTB, 2000, 'outline')];

    expect(kindsOf(planBox([DLTB], BOX, 12, fakeView(styled).view))).toStrictEqual([['bgdc_dltb', 'server']]);
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

describe('isEmptyValue', () => {
  it('null、空字符串和 -9999、-999（数字或字符串）没有值；0、false、"-" 和其他负数有值', () => {
    const empty = [null, undefined, '', -9999, '-9999', -999, '-999'];
    const filled = [0, '0', false, '-', -1, -99999, ' '];

    expect(empty.map(isEmptyValue)).toStrictEqual(empty.map(() => true));
    expect(filled.map(isEmptyValue)).toStrictEqual(filled.map(() => false));
  });
});

describe('featureLabel', () => {
  it('地类（编码、名称配色）：名称是地类名称，分类是地类编码', () => {
    const properties = { dlmc: '旱地', dlbm: '0103', name: '不用的名称', zldwmc: '欢口镇常庄村' };

    expect(featureLabel('bgdc_dltb', properties)).toStrictEqual({ name: '旱地', category: '0103' });
    expect(featureLabel('bgdc_dltb_czc', properties)).toStrictEqual({ name: '旱地', category: '0103' });
    expect(featureLabel('bgdc_dltb', { DLMC: '水田', DLBM: '0101' })).toStrictEqual({ name: '水田', category: '0101' });
  });

  it('城市现状数据：名称取 name，没有值时取分类名称；分类取 type，没有值时取分类名称，和名称相同时不写', () => {
    const station = { name: '涵西村微型消防站', ccn: '消防站', type: '微型消防站' };
    const pond = { name: '-9999', ccn: '坑塘', type: '-9999' };
    const road = { name: -9999, type: '支路' };

    expect(featureLabel('csxhjctb_gyssp', station)).toStrictEqual({ name: '涵西村微型消防站', category: '微型消防站' });
    expect(featureLabel('csxhjctb_gyssp', { ...station, type: '' })).toStrictEqual({
      name: '涵西村微型消防站',
      category: '消防站'
    });
    expect(featureLabel('csxhjctb_hyda', pond)).toStrictEqual({ name: '坑塘', category: null });
    expect(featureLabel('csxhjctb_road', road)).toStrictEqual({ name: null, category: '支路' });
  });

  it('其他资源：名称取坐落单位名称，没有值时取 name，没有分类；数字照常显示，对象不算名称', () => {
    expect(featureLabel('bgdc_cjdcq', { zldwmc: '后坝村', name: '不用的名称' })).toStrictEqual({
      name: '后坝村',
      category: null
    });
    expect(featureLabel('szy_market', { zldwmc: '', name: 42 }).name).toBe('42');
    expect(featureLabel('szy_market', { name: { text: '某市场' } }).name).toBeNull();
    expect(featureLabel('bgdc_cjdcqjx', { bsm: '320321125000000165' })).toStrictEqual({ name: null, category: null });
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
    ngrade: '-9999',
    kcmj: 0,
    extra: { a: 1 }
  };

  it('不列主键和几何；有值的和没有值的分开，各自按返回的顺序', () => {
    const { filled, empty } = featureRows(properties);

    expect(filled.map(row => [row.key, row.value])).toStrictEqual([
      ['bsm', '320826211000006380'],
      ['DLMC', '水田'],
      ['tbmj', '6033.8398'],
      ['sfjz', 'false'],
      ['kcmj', '0'],
      ['extra', '{"a":1}']
    ]);
    expect(empty.map(row => [row.key, row.value])).toStrictEqual([
      ['bz', null],
      ['kcxs', null],
      ['ngrade', null]
    ]);
  });

  it('字段名按三调的字段名表（大小写不敏感），不分资源；表里没有的为 null', () => {
    const { filled, empty } = featureRows(properties);

    expect([...filled, ...empty].map(row => row.label)).toStrictEqual([
      '标识码',
      '地类名称',
      '图斑面积',
      null,
      '扣除地类面积',
      null,
      '备注',
      '扣除地类系数',
      null
    ]);
  });
});

// 经纬度的矩形
function rect(west: number, south: number, east: number, north: number): Polygon {
  const ring: Position[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
  return { type: 'Polygon', coordinates: [ring] };
}

// 拾取和投影互逆：经纬度是屏幕坐标的百分之一；渲染要素按数据源返回，没要几何时去掉几何
function scopedView(features: readonly RenderedFeature[], kind: ViewKind = '2d') {
  const queries: [ScreenPoint | ScreenBox, RenderedQueryOptions][] = [];
  const view = {
    kind,
    pick: ({ x, y }: ScreenPoint): PickResult => ({ kind: 'hit', surface: 'map', lngLat: [x / 100, y / 100] }),
    project: ([lng, lat]: LngLat): ScreenPoint => ({ x: lng * 100, y: lat * 100 }),
    queryRendered: (area: ScreenPoint | ScreenBox, options: RenderedQueryOptions): RenderedFeature[] => {
      queries.push([area, options]);
      return features
        .filter(({ sourceId }) => options.sources.includes(sourceId))
        .map(({ sourceId, layerId, properties, geometry }) =>
          options.withGeometry && geometry
            ? { sourceId, layerId, properties, geometry }
            : { sourceId, layerId, properties }
        );
    }
  };
  return { view, queries };
}

function shaped(target: PickResource, id: string, geometry: Geometry): RenderedFeature {
  return { sourceId: target.sourceId, layerId: target.sourceId, properties: { guid: guid(id) }, geometry };
}

const vertical = (lng: number): LineString => line([lng, 0.4], [lng, 0.6]);

// 区划：经纬度 0～1 的正方形，屏幕上是 0～100 像素
const SCOPE: RegionScope = rect(0, 0, 1, 1);

// 区划里挖了 40 个小洞：和它求交的范围坐标太多，简化也压不下来
const HOLED: RegionScope = {
  type: 'Polygon',
  coordinates: [
    rect(0, 0, 1, 1).coordinates[0] ?? [],
    ...Array.from({ length: 40 }, (_, index) => {
      const [x, y] = [0.905 + (index % 8) * 0.01, 0.42 + Math.floor(index / 8) * 0.02];
      return (rect(x, y, x + 0.002, y + 0.002).coordinates[0] ?? []).toReversed();
    })
  ]
};

describe('区划范围（ADR 0051 第 3、4 节）', () => {
  it('单击在区划外（遮罩上）时为 null，不查询；区划里的面也取几何，和区划不相交的去掉', () => {
    const outside = scopedView([shaped(DLTB, 'a', rect(1.2, 0.2, 1.4, 0.4))]);
    expect(planIdentify([DLTB], { x: 150, y: 50 }, 15, outside.view, SCOPE)).toBeNull();
    expect(outside.queries).toStrictEqual([]);

    const { view, queries } = scopedView([
      shaped(DLTB, 'a', rect(0.4, 0.4, 0.6, 0.6)),
      shaped(DLTB, 'b', rect(1.2, 0.2, 1.4, 0.4))
    ]);
    const [task] = planIdentify([DLTB], { x: 50, y: 50 }, 15, view, SCOPE) ?? [];
    expect(task?.kind === 'rendered' && task.candidates.map(({ guid: id }) => id)).toStrictEqual([guid('a')]);
    expect(queries[0]?.[1]).toStrictEqual({ sources: [DLTB.sourceId], withGeometry: true });
  });

  it('线的容差框和区划求交：同一个 guid 有一段在里面就保留，距离只按里面的算；都在外面的去掉', () => {
    const { view } = scopedView([
      shaped(LCTL, 'a', vertical(0.94)),
      shaped(LCTL, 'a', vertical(1.005)),
      shaped(LCTL, 'b', vertical(1.04))
    ]);

    const [task] = planIdentify([LCTL], { x: 98, y: 50 }, 15, view, SCOPE) ?? [];

    expect(task?.kind === 'rendered' && task.candidates.map(({ guid: id, distance }) => [id, distance])).toStrictEqual([
      [guid('a'), 4]
    ]);
  });

  it('查后端时：线用容差框和区划的交集（整理过的几何），面仍用点击位置', () => {
    const { view } = scopedView([]);

    const [lineTask, parcelTask] = planIdentify([HYDL, DLTB], { x: 98, y: 50 }, 12, view, SCOPE) ?? [];

    if (lineTask?.kind !== 'server' || lineTask.geometry.type === 'Point') {
      throw new Error('线应当用求交范围查后端');
    }
    expect(bbox(lineTask.geometry).map(value => Number(value.toFixed(6)))).toStrictEqual([0.9, 0.42, 1, 0.58]);
    expect(isValidPolygonal(lineTask.geometry)).toBe(true);
    expect(parcelTask).toStrictEqual({
      kind: 'server',
      target: DLTB,
      geometry: { type: 'Point', coordinates: [0.98, 0.5] }
    });
  });

  it('求交范围整理不成能发给后端的几何时是"范围太复杂"，停下，下面的资源不再查询', () => {
    const { view, queries } = scopedView([]);

    expect(planIdentify([HYDL, DLTB], { x: 98, y: 50 }, 12, view, HOLED)).toStrictEqual([
      { kind: 'too-complex', target: HYDL }
    ]);
    expect(queries.map(([, { sources }]) => sources)).toStrictEqual([[HYDL.sourceId]]);
  });

  it('同一几何类型的资源共用容差框、求交范围和整理过的几何：一次点选里只拾取、求交一次', () => {
    const { view } = scopedView([]);
    let picks = 0;
    const counted = {
      ...view,
      pick: (point: ScreenPoint) => {
        picks += 1;
        return view.pick(point);
      }
    };
    const plan = (targets: readonly PickResource[]) => {
      picks = 0;
      const tasks = planIdentify(targets, { x: 98, y: 50 }, 12, counted, SCOPE) ?? [];
      return { tasks, picks };
    };

    const single = plan([HYDL]);
    const shared = plan([HYDL, LVLL, LCTL]);

    expect(kindsOf(shared.tasks)).toStrictEqual([
      ['csxhjctb_hydl', 'server'],
      ['csxhjctb_lvll', 'server']
    ]);
    expect(shared.picks).toBe(single.picks);
    const [hydl, lvll] = shared.tasks;
    expect(hydl?.kind === 'server' && lvll?.kind === 'server' && hydl.geometry === lvll.geometry).toBe(true);
  });

  it('框整个在区划外时为 null，不查询', () => {
    const { view, queries } = scopedView([shaped(DLTB, 'a', rect(1.2, 0.2, 1.4, 0.4))]);

    expect(planBox([DLTB], { from: { x: 120, y: 0 }, to: { x: 200, y: 100 } }, 15, view, SCOPE)).toBeNull();
    expect(queries).toStrictEqual([]);
  });

  it('框选的渲染要素先按求交范围过滤再去重、计数：跨过边界的留下，同一个 guid 只要有一段在里面', () => {
    const { view, queries } = scopedView([
      shaped(DLTB, 'a', rect(0.6, 0.2, 0.7, 0.3)),
      shaped(DLTB, 'b', rect(1.2, 0.2, 1.3, 0.3)),
      shaped(DLTB, 'c', rect(0.9, 0.5, 1.1, 0.6)),
      shaped(DLTB, 'd', rect(1.1, 0.7, 1.2, 0.8)),
      shaped(DLTB, 'd', rect(0.8, 0.7, 0.9, 0.8)),
      // 判断不了在不在范围里的不算
      rendered(DLTB.sourceId, { guid: guid('e') })
    ]);
    const box = { from: { x: 50, y: 0 }, to: { x: 150, y: 100 } };

    const [task] = planBox([DLTB], box, 15, view, SCOPE) ?? [];

    expect(task?.kind === 'rendered' && task.candidates.map(({ guid: id }) => id)).toStrictEqual([
      guid('a'),
      guid('c'),
      guid('d')
    ]);
    expect(queries).toStrictEqual([[box, { sources: [DLTB.sourceId], withGeometry: true }]]);
  });

  it('框里只有区划外的渲染要素时这个资源没有候选，看下面的资源', () => {
    const { view } = scopedView([shaped(DLTB, 'b', rect(1.2, 0.2, 1.3, 0.3)), shaped(LCTL, 'a', vertical(0.7))]);

    const tasks = planBox([DLTB, LCTL], { from: { x: 50, y: 0 }, to: { x: 150, y: 100 } }, 15, view, SCOPE);

    expect(tasks && kindsOf(tasks)).toStrictEqual([['csxhjctb_lctl', 'rendered']]);
  });

  it('查后端时估数只数求交范围在屏幕上的外包框里的，后端用整理过的求交范围', () => {
    const { view, queries } = scopedView([]);

    const tasks = planBox([DLTB], { from: { x: 50, y: 0 }, to: { x: 150, y: 100 } }, 12, view, SCOPE);

    expect(queries).toStrictEqual([[{ from: { x: 50, y: 0 }, to: { x: 100, y: 100 } }, { sources: [DLTB.sourceId] }]]);
    const [task] = tasks ?? [];
    if (task?.kind !== 'server' || task.geometry.type === 'Point') {
      throw new Error('应当用求交范围查后端');
    }
    expect(bbox(task.geometry)).toStrictEqual([0.5, 0, 1, 1]);
    expect(vertexCount(task.geometry)).toBeLessThanOrEqual(QUERY_VERTEX_LIMIT);
  });

  it('范围太复杂时停在这个资源，不再看下面的资源', () => {
    const { view, queries } = scopedView([shaped(LCTL, 'a', vertical(0.7))]);

    const tasks = planBox([DLTB, LCTL], { from: { x: 50, y: 0 }, to: { x: 150, y: 100 } }, 12, view, HOLED);

    expect(tasks).toStrictEqual([{ kind: 'too-complex', target: DLTB }]);
    expect(queries).toHaveLength(1);
  });
});
