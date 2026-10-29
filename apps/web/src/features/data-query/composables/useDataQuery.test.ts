import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import type { CameraState, MapInputEvent, MapPointerEvent, ToolView, ViewBounds } from '@yzt/map-core';
import type { CameraControl, CameraOperation, MapViewport } from '@yzt/map-vue';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref, shallowRef } from 'vue';
import { JIANGSU_BOUNDS } from '@/shared/map/jiangsu';
import { DRAW_TOOL_IDS } from '@/shared/map/draw/useShapeDraw';
import type { RegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { required } from '@/shared/testing/required';
import { PARSE_DELAY } from './useNaturalLanguage';
import { type DataQuery, type SubmitResult, useDataQuery } from './useDataQuery';
import { QUERY_TOPICS, type TopicId } from '../topics';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

const PAGE = { total: 2, pageNum: 1, pages: 1, list: [{ name: '甲' }, { name: '乙' }] };
const FEATURES = [
  { guid: 'a', geom: '{"type":"Point","coordinates":[118.1,32.9]}' },
  { guid: 'b', geom: '{"type":"Point","coordinates":[118.2,32.8]}' },
  { guid: 'c', geom: '{"type":"Point","coordinates":[118.15,32.85]}' }
];
const NANJING: ViewBounds = [118.35, 31.23, 119.24, 32.62];

// 记下每次请求的接口和参数
function mockQueries() {
  const requests: string[] = [];
  const record = (request: Request) => {
    const url = new URL(request.url);
    requests.push(`${url.pathname.replace('/backend/api/query/', '')} ${url.searchParams.get('conditions') ?? ''}`);
  };
  server.use(
    mock.get('/backend/api/query/attr/page', ({ request }) => {
      record(request);
      return HttpResponse.json(PAGE);
    }),
    mock.get('/backend/api/query/scope/geojson', ({ request }) => {
      record(request);
      return HttpResponse.json(FEATURES);
    }),
    mock.get('/backend/api/query/scope/geojson/page', ({ request }) => {
      record(request);
      return HttpResponse.json(PAGE);
    })
  );
  return requests;
}

// 拾取：每像素 0.001 度，画布左上角是 (118, 33)
function toolView(): ToolView {
  return {
    kind: '2d',
    pick: ({ x, y }) => ({ kind: 'hit', surface: 'map', lngLat: [118 + x / 1000, 33 - y / 1000] }),
    project: () => null,
    queryRendered: () => []
  };
}

const pointer = (type: MapPointerEvent['type'], x: number, y: number): MapPointerEvent => ({
  type,
  point: { x, y },
  button: 0,
  clickCount: 1,
  modifiers: { shift: false, ctrl: false, alt: false, meta: false }
});

function setup(topicId: TopicId = 'space-monitoring') {
  const fitBounds = vi.fn<CameraControl['fitBounds']>();
  const control: CameraControl = {
    fitBounds,
    flyTo: vi.fn<CameraControl['flyTo']>(),
    reveal: vi.fn<CameraControl['reveal']>()
  };
  const beginCameraOperation = (): CameraOperation => {
    const controller = new AbortController();
    return { signal: controller.signal, run: action => action(control) };
  };
  const activeTool = ref('browse');
  const map = {
    beginCameraOperation,
    useCamera: () => shallowRef<CameraState>({ center: [119, 33], zoom: 7, bearing: 0, pitch: 0 }),
    view: shallowRef<MapViewport | null>({ ...toolView(), eyeHeight: () => null, heading: () => null }),
    pointer: shallowRef(null),
    activeTool,
    activateTool: (id: string) => {
      activeTool.value = id;
    },
    releaseTool: (id: string) => {
      if (activeTool.value === id) {
        activeTool.value = 'browse';
      }
    }
  };
  const loader: RegionBoundaryLoader = {
    load: async region => ({ code: region.code, geometry: { type: 'Polygon', coordinates: [] }, bounds: NANJING }),
    districtCodeAt: async () => null
  };
  const drawn: SubmitResult[] = [];
  let query: DataQuery | undefined;
  const Host = defineComponent({
    setup() {
      query = useDataQuery({
        topic: QUERY_TOPICS[topicId],
        map,
        loader,
        onDrawSubmit: result => drawn.push(result)
      });
      return () => null;
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  const owner = required(query, '数据查询的拥有者');
  // 在地图上拖一个框：框选工具收到按下、移动、松开
  const dragBox = (from: [number, number], to: [number, number]) => {
    const tool = owner.spatial.draw.tools[DRAW_TOOL_IDS.rectangle];
    const send = (event: MapInputEvent) => tool.handleInput?.(event, toolView());
    send(pointer('down', ...from));
    send(pointer('move', ...to));
    send(pointer('up', ...to));
  };
  return { query: owner, fitBounds, activeTool, drawn, dragBox };
}

describe('属性查询', () => {
  it('没选图层时不能查询；选了图层默认全省和默认条件，查询后结果表和第一个结果都到了，定位到全省', async () => {
    const requests = mockQueries();
    const { query, fitBounds } = setup();
    expect(await query.submit()).toStrictEqual({ kind: 'invalid', reason: '未选择图层' });

    query.attribute.setLayer('csxhjctb_xxa_2022');
    expect(query.attribute.region.value).toBe('320000');
    expect(query.attribute.conditions.value.map(({ field }) => field.field)).toStrictEqual(['TYPE']);
    expect(await query.submit()).toStrictEqual({ kind: 'submitted' });
    await flushPromises();

    expect(requests).toStrictEqual(["attr/page TYPE IN ('普通高等学校本科院校','小学','高级中学','托儿所')"]);
    expect(query.result.page.value?.list).toHaveLength(2);
    expect(query.result.outcome.value).toMatchObject({ status: 'success', total: 2 });
    expect(fitBounds).toHaveBeenCalledWith(JIANGSU_BOUNDS, { maxZoom: 14 });
  });

  it('选到市时定位到市界；清掉行政区划时不能查询', async () => {
    mockQueries();
    const { query, fitBounds } = setup();
    query.attribute.setLayer('csxhjctb_xxa_2022');
    query.attribute.setRegion('320100');
    await query.submit();
    await flushPromises();
    expect(fitBounds).toHaveBeenLastCalledWith(NANJING, { maxZoom: 14 });

    query.attribute.setRegion(null);
    expect(await query.submit()).toStrictEqual({ kind: 'invalid', reason: '请选择行政区划' });
  });
});

describe('页签切换', () => {
  it('属性查询和自然语言查询共用结果；切到空间、高级查询时清掉结果', async () => {
    mockQueries();
    const { query } = setup();
    query.attribute.setLayer('csxhjctb_xxa_2022');
    await query.submit();
    await flushPromises();

    query.changeTab('natural');
    expect(query.result.request.value).not.toBeNull();
    query.changeTab('spatial');
    expect(query.result.request.value).toBeNull();
  });

  it('离开空间查询时结束绘制、清掉画的范围', async () => {
    mockQueries();
    const { query, activeTool, dragBox } = setup();
    query.changeTab('spatial');
    query.spatial.draw.toggle('rectangle');
    dragBox([100, 100], [300, 200]);
    query.spatial.draw.toggle('polygon');
    expect(query.spatial.scope.value?.kind).toBe('shape');

    query.changeTab('advanced');
    expect(activeTool.value).toBe('browse');
    expect(query.spatial.scope.value).toBeNull();
  });
});

describe('空间查询', () => {
  it('没有范围时按正在用的方式提示；画完没选图层时提示选图层', async () => {
    const { query, drawn, dragBox } = setup();
    query.changeTab('spatial');
    query.spatial.setLayer('csxhjctb_xxp_2022');
    expect(await query.submit()).toStrictEqual({ kind: 'invalid', reason: '请先选择空间查询方式' });
    query.spatial.draw.toggle('rectangle');
    expect(await query.submit()).toStrictEqual({ kind: 'invalid', reason: '请先完成框选' });

    query.spatial.reset();
    query.spatial.draw.toggle('rectangle');
    dragBox([100, 100], [300, 200]);
    expect(drawn).toStrictEqual([{ kind: 'drawn' }]);
    expect(query.result.request.value).toBeNull();
  });

  it('选了图层时画完直接查询：要素画在地图上，第一个结果报命中数，定位到放大一倍的外包框', async () => {
    const requests = mockQueries();
    const { query, drawn, dragBox, fitBounds } = setup();
    query.changeTab('spatial');
    query.spatial.setLayer('csxhjctb_xxp_2022');
    query.spatial.draw.toggle('rectangle');
    dragBox([100, 100], [300, 200]);
    await flushPromises();

    expect(drawn).toStrictEqual([{ kind: 'submitted' }]);
    expect(requests.toSorted()).toStrictEqual(['scope/geojson ', 'scope/geojson/page ']);
    expect(query.result.outcome.value).toMatchObject({ status: 'success', total: 3 });
    expect(fitBounds).toHaveBeenCalledOnce();
    const [west, south, east, north] = required(fitBounds.mock.calls[0]?.[0], '定位的范围');
    expect([west, south, east, north].map(value => Number(value.toFixed(3)))).toStrictEqual([118, 32.75, 118.4, 32.95]);
  });

  it('开始画新的范围时，上一次的结果作废', async () => {
    mockQueries();
    const { query, dragBox } = setup();
    query.changeTab('spatial');
    query.spatial.setLayer('csxhjctb_xxp_2022');
    query.spatial.draw.toggle('rectangle');
    dragBox([100, 100], [300, 200]);
    await flushPromises();
    expect(query.result.request.value).not.toBeNull();

    query.spatial.draw.toggle('rectangle');
    const tool = query.spatial.draw.tools[DRAW_TOOL_IDS.rectangle];
    tool.handleInput?.(pointer('down', 10, 10), toolView());
    tool.handleInput?.(pointer('move', 60, 60), toolView());
    expect(query.result.request.value).toBeNull();
  });
});

describe('高级查询', () => {
  it('SQL 里写了别的图层时切到那个图层；没写区划时用属性查询选的区划', async () => {
    const requests = mockQueries();
    const { query } = setup('land-change');
    query.attribute.setLayer('bgdc_dltb_2022');
    query.attribute.setRegion('320100');
    query.changeTab('advanced');
    query.advanced.setLayer('bgdc_dltb_2022');
    query.advanced.sql.value = "SELECT * FROM bgdc_czcdyd_2022 WHERE CZCLX = '201'";

    expect(await query.submit()).toStrictEqual({ kind: 'submitted' });
    await flushPromises();
    expect(query.advanced.layer.value?.label).toBe('城镇村等用地');
    expect(query.result.request.value).toMatchObject({ origin: 'advanced', xzqdm: '320100' });
    expect(requests).toStrictEqual(["attr/page CZCLX = '201'"]);
    expect(query.exporter.blocked.value).toBe('高级查询暂不支持导出');
  });

  it('写了专题里没有的表时不能查询', async () => {
    const { query } = setup('land-change');
    query.changeTab('advanced');
    query.advanced.sql.value = 'SELECT * FROM csxhjctb_xxa_2022 WHERE 1 = 1';
    expect(await query.submit()).toStrictEqual({ kind: 'invalid', reason: '未匹配到高级查询图层' });
  });
});

describe('自然语言查询', () => {
  it('等待之后按规则回填属性查询并查询；没有匹配的规则时不查询', async () => {
    mockQueries();
    vi.useFakeTimers();
    const { query } = setup('land-change');
    query.changeTab('natural');
    const natural = required(query.natural, '自然语言查询');

    const submitted = query.submit();
    expect(natural.parsing.value).toBe(true);
    expect(query.busy.value).toBe(true);
    await vi.advanceTimersByTimeAsync(PARSE_DELAY);
    expect(await submitted).toStrictEqual({ kind: 'submitted' });
    expect(query.attribute.layer.value?.table).toBe('bgdc_czcdyd_2022');
    expect(query.attribute.region.value).toBe('320100');
    expect(query.result.request.value).toMatchObject({ origin: 'natural', conditions: "CZCLX IN ('201','201A')" });
    expect(natural.parsed.value).toBe(true);

    natural.setText('查询江苏省南京市耕地分布');
    const unrecognized = query.submit();
    await vi.advanceTimersByTimeAsync(PARSE_DELAY);
    expect(await unrecognized).toStrictEqual({ kind: 'unrecognized' });
  });

  it('解析中切走页签时作废，不回填也不查询；重置同时清掉属性查询', async () => {
    vi.useFakeTimers();
    const { query } = setup('land-change');
    query.changeTab('natural');
    const submitted = query.submit();
    query.changeTab('attribute');
    await vi.advanceTimersByTimeAsync(PARSE_DELAY);
    expect(await submitted).toStrictEqual({ kind: 'canceled' });
    expect(query.attribute.layer.value).toBeNull();

    query.attribute.setLayer('bgdc_dltb_2022');
    query.changeTab('natural');
    query.reset();
    expect(query.attribute.layer.value).toBeNull();
  });
});
