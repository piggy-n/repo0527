import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { bbox } from '@turf/bbox';
import { mount } from '@vue/test-utils';
import type { Point, Polygon, Position } from 'geojson';
import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import type {
  CameraState,
  MapInputEvent,
  MapPointerEvent,
  RenderedFeature,
  ScreenPoint,
  ToolView,
  ViewKind
} from '@yzt/map-core';
import type { CameraControl, CameraOperation, MapContext } from '@yzt/map-vue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, shallowRef } from 'vue';
import type { RegionScope } from '@/shared/map/region/region-scope';
import { FEATURE_PICK_TOOL } from '@/shared/map/toolbar/toolbar-items';
import type { ResourceTreeCategory, ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import type { PickCandidate } from '../feature-query';
import { type ResourceDisplay, type ResourceLayersState, withYearForAll } from '../resource-layers';
import { type FeaturePick, hasMorePages, useFeaturePick } from './useFeaturePick';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});

afterAll(() => {
  server.close();
});

function layer(code: string, geoType: ResourceTreeLayer['geoType'], ...yearList: [number, ...number[]]) {
  return { code, name: `${code} 的名称`, geoType, yearList };
}

const tree: ResourceTreeCategory[] = [
  {
    code: null,
    name: '测试',
    children: [
      layer('csxhjctb_lctl', 'Line', 2025),
      layer('bgdc_czcdyd', 'Polygon', 2021, 2022),
      layer('bgdc_dltb', 'Polygon', 2022),
      layer('szy_kt', 'Polygon', 2025)
    ]
  }
];
const CATALOG = buildCatalog(tree);

const display = (year: number): ResourceDisplay => ({ checked: true, opacity: 1, year });

function withDisplay(state: ResourceLayersState, code: string, change: Partial<ResourceDisplay>): ResourceLayersState {
  const current = state.displays.get(code);
  if (!current) {
    throw new Error(`没有 ${code} 的显示状态`);
  }
  return { ...state, displays: new Map([...state.displays, [code, { ...current, ...change }]]) };
}

// 从上到下：城市道路（不能后端识别）、城镇村等用地（能后端识别，ADR 0048 第 1 节）、地类图斑、坑塘（不能查询）
const STATE: ResourceLayersState = {
  catalog: CATALOG,
  displays: new Map([
    ['csxhjctb_lctl', display(2025)],
    ['bgdc_czcdyd', display(2022)],
    ['bgdc_dltb', display(2022)],
    ['szy_kt', display(2025)]
  ]),
  order: ['csxhjctb_lctl', 'bgdc_czcdyd', 'bgdc_dltb', 'szy_kt']
};

const DLTB = 'resources-bgdc_dltb';
const CZCDYD = 'resources-bgdc_czcdyd';
const SZY = 'resources-szy_kt';

const guid = (index: number) => index.toString(16).padStart(32, '0');
const POINT = { type: 'Point', coordinates: [119.28, 33.82] };
const page = (total: number, list: unknown[]) => ({ total, list, pageNum: 1, pages: 1 });
const FAILURE = { success: false, code: 500, data: null, msg: '系统异常' };

function rendered(sourceId: string, id: number): RenderedFeature {
  return { sourceId, layerId: sourceId, properties: { guid: guid(id), name: `要素 ${id}` } };
}

// 拾取：每像素 0.001 度，画布左上角是 (118, 33)；渲染要素按数据源返回给定的
function toolView(features: readonly RenderedFeature[], kind: ViewKind): ToolView {
  return {
    kind,
    pick: ({ x, y }) => ({ kind: 'hit', surface: 'map', lngLat: [118 + x / 1000, 33 - y / 1000] }),
    project: ([lng, lat]) => ({ x: (lng - 118) * 1000, y: (33 - lat) * 1000 }),
    queryRendered: (_area, { sources }) => features.filter(({ sourceId }) => sources.includes(sourceId))
  };
}

function click(x = 100, y = 100, clickCount = 1): MapPointerEvent {
  const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
  return { type: 'click', point: { x, y }, button: 0, clickCount, modifiers };
}

/** 后端识别：按图层编码和页码返回；记下请求 */
function mockIdentify(respond: (layerCode: string, pageNum: number) => JsonBodyType | Promise<JsonBodyType>) {
  const requests: { layerCode: string; pageNum: number; geometry: unknown }[] = [];
  server.use(
    mock.get('/backend/api/query/scope/geojson/page', async ({ request }) => {
      const params = new URL(request.url).searchParams;
      const layerCode = params.get('layerCode') ?? '';
      const pageNum = Number(params.get('pageNum'));
      requests.push({ layerCode, pageNum, geometry: JSON.parse(params.get('geometry') ?? 'null') });
      return HttpResponse.json(await respond(layerCode, pageNum));
    })
  );
  return requests;
}

// 条件是 "guid" = '…'，取出其中的 guid
const guidOf = (request: Request) => (new URL(request.url).searchParams.get('conditions') ?? '').slice(10, 42);

/** 详情：按 guid 返回属性和同一个点；fail 返回 true 时属性接口出错 */
function mockDetail(fail: () => boolean = () => false) {
  const requests: string[] = [];
  server.use(
    mock.get('/backend/api/query/attr/page', ({ request }) => {
      requests.push(guidOf(request));
      return HttpResponse.json(fail() ? FAILURE : page(1, [{ guid: guidOf(request), name: '详情' }]));
    }),
    mock.get('/backend/api/query/scope/geojson', ({ request }) =>
      HttpResponse.json([{ guid: guidOf(request), geom: JSON.stringify(POINT) }])
    )
  );
  return requests;
}

/** 由测试放行的响应 */
function gate() {
  let release: (() => void) | undefined;
  const opened = new Promise<void>(resolve => {
    release = resolve;
  });
  return { opened, open: () => release?.() };
}

// 相机操作：开始新的作废旧的，没作废时立即执行
function fakeCamera(zoom: number) {
  const camera = shallowRef<CameraState>({ center: [119, 33], zoom, bearing: 0, pitch: 0 });
  const fitBounds = vi.fn<CameraControl['fitBounds']>();
  const flyTo = vi.fn<CameraControl['flyTo']>();
  const reveal = vi.fn<CameraControl['reveal']>();
  let current = new AbortController();
  const beginCameraOperation = vi.fn<() => CameraOperation>(() => {
    current.abort();
    const controller = new AbortController();
    current = controller;
    return {
      signal: controller.signal,
      run: action => {
        if (!controller.signal.aborted) {
          action({ fitBounds, flyTo, reveal });
        }
      }
    };
  });
  const runCameraOperation = vi.fn<MapContext['runCameraOperation']>(action => beginCameraOperation().run(action));
  const interrupt = () => current.abort();
  return { camera, fitBounds, flyTo, reveal, beginCameraOperation, runCameraOperation, interrupt };
}

function setup(
  zoom = 15,
  state = STATE,
  invalid: ReadonlyMap<string, readonly string[]> = new Map(),
  initialScope: RegionScope | null = null,
  onIdentifyStart = vi.fn<() => void>()
) {
  const fake = fakeCamera(zoom);
  // 区划裁剪的范围，可以由用例中途改变
  const scope = shallowRef(initialScope);
  const select = vi.fn<MapContext['select']>();
  const map = { useCamera: () => fake.camera, select, ...fake };
  // 校验结果可以由用例中途改变
  const errors = shallowRef(invalid);
  const resources = { state: shallowRef(state), errors, configErrors: computed(() => errors.value) };
  let owner: FeaturePick | undefined;
  const Host = defineComponent({
    setup() {
      owner = useFeaturePick(map, resources, { scope: () => scope.value, onIdentifyStart });
      return () => null;
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  if (!owner) {
    throw new Error('没有创建选择的拥有者');
  }
  const pick = owner.tools[FEATURE_PICK_TOOL];
  const send = (event: MapInputEvent, features: readonly RenderedFeature[] = [], kind: ViewKind = '2d') =>
    pick.handleInput?.(event, toolView(features, kind));
  return { owner, pick, send, select, resources, scope, onIdentifyStart, ...fake };
}

type Owner = ReturnType<typeof setup>['owner'];

const kindOf = (owner: Owner) => owner.state.value.kind;

function candidatesOf(owner: Owner): readonly PickCandidate[] {
  const state = owner.state.value;
  return state.kind === 'candidates' ? state.list.candidates : [];
}

function listIdOf(owner: Owner): number | null {
  const state = owner.state.value;
  return state.kind === 'candidates' ? state.list.id : null;
}

function selectedGuid(owner: Owner): string | null {
  const state = owner.state.value;
  return state.kind === 'detail' ? state.candidate.guid : null;
}

function backOf(owner: Owner) {
  const state = owner.state.value;
  return state.kind === 'detail' ? state.back : undefined;
}

const highlighted = (owner: Owner) => owner.deriveGroup().sources.selection !== undefined;

function highlightColor(owner: Owner): unknown {
  const [fill] = owner.deriveGroup().layers;
  return fill?.type === 'fill' ? fill.paint?.['fill-color'] : undefined;
}

describe('useFeaturePick：识别', () => {
  it('14 级起点中一个渲染要素：直接进入详情，不定位；会话记下选中的要素，详情到了以后高亮', async () => {
    mockDetail();
    const { owner, send, select, fitBounds } = setup(15);

    expect(send(click(), [rendered(DLTB, 1)])).toBe(true);

    expect(owner.state.value).toMatchObject({ kind: 'detail', back: null });
    expect(selectedGuid(owner)).toBe(guid(1));
    expect(owner.detail.value).toStrictEqual({ kind: 'loading' });
    expect(highlighted(owner)).toBe(false);
    await nextTick();
    expect(select).toHaveBeenLastCalledWith([{ sourceId: DLTB, featureId: guid(1) }]);

    await vi.waitFor(() => expect(owner.detail.value?.kind).toBe('ready'));
    expect(owner.detail.value).toMatchObject({ detail: { properties: { guid: guid(1) }, geometry: POINT } });
    expect(highlighted(owner)).toBe(true);
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('单击开始识别时通知页面（ADR 0053 第 4 节）；不识别的输入不通知；回调抛错不打断识别', () => {
    const { owner, send, onIdentifyStart } = setup(15);
    const features = [rendered(DLTB, 1), rendered(DLTB, 2)];

    send(click(100, 100, 2), features);
    send({ ...click(), button: 2 }, features);
    expect(onIdentifyStart).not.toHaveBeenCalled();

    send(click(), features);
    expect(onIdentifyStart).toHaveBeenCalledOnce();
    expect(kindOf(owner)).toBe('candidates');

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onIdentifyStart.mockImplementation(() => {
      throw new Error('页面的回调出错');
    });
    send(click(), [rendered(DLTB, 3)]);
    expect(selectedGuid(owner)).toBe(guid(3));
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('点中多个要素时列出候选；双击的第二下、右键、拖动后的松手不识别', () => {
    const { owner, send } = setup(15);
    const features = [rendered(DLTB, 1), rendered(DLTB, 2)];

    expect(send(click(100, 100, 2), features)).toBe(false);
    expect(send({ ...click(), button: 2 }, features)).toBe(false);
    expect(send({ ...click(), type: 'up' }, features)).toBe(false);
    expect(kindOf(owner)).toBe('idle');

    send(click(), features);

    expect(owner.state.value).toMatchObject({ kind: 'candidates', list: { pages: null }, more: { kind: 'idle' } });
    expect(candidatesOf(owner).map(candidate => candidate.guid)).toStrictEqual([guid(1), guid(2)]);
  });

  it('级别不够时从上到下查后端：不能识别的跳过，第一个有结果的胜出；只有一个结果时直接进入详情并定位', async () => {
    const requests = mockIdentify((layerCode, pageNum) =>
      layerCode === 'bgdc_dltb_2022' && pageNum === 1 ? page(1, [{ guid: guid(7), dlmc: '水田' }]) : page(0, [])
    );
    mockDetail();
    const { owner, send, fitBounds } = setup(12);

    send(click(100, 100));

    expect(kindOf(owner)).toBe('identifying');
    await vi.waitFor(() => expect(kindOf(owner)).toBe('detail'));
    expect(requests).toStrictEqual([
      { layerCode: 'bgdc_czcdyd_2022', pageNum: 1, geometry: { type: 'Point', coordinates: [118.1, 32.9] } },
      { layerCode: 'bgdc_dltb_2022', pageNum: 1, geometry: { type: 'Point', coordinates: [118.1, 32.9] } }
    ]);
    expect(owner.state.value).toMatchObject({ candidate: { guid: guid(7), origin: 'server' }, back: null });

    await vi.waitFor(() => expect(fitBounds).toHaveBeenCalledOnce());
    expect(fitBounds).toHaveBeenCalledWith([119.28, 33.82, 119.28, 33.82], { maxZoom: 17 });
  });

  it('被校验拦下的资源不参与识别', () => {
    const { owner, send } = setup(15, STATE, new Map([['bgdc_dltb', ['图层不合法']]]));

    send(click(), [rendered(DLTB, 1), rendered(SZY, 2)]);

    expect(owner.state.value).toMatchObject({ kind: 'detail', candidate: { target: { sourceId: SZY } } });
  });

  it('二维 14 级起只用渲染要素：上面的资源为空、下面的命中时不发识别请求，全部为空时不发任何请求', async () => {
    const requests = mockIdentify(() => page(0, []));
    const { owner, send } = setup(14);

    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);
    expect(kindOf(owner)).toBe('candidates');
    send(click(), []);
    expect(kindOf(owner)).toBe('empty');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(requests).toStrictEqual([]);
  });

  it('13.99 级仍查后端：有渲染要素也用后端的结果', async () => {
    const requests = mockIdentify(layerCode =>
      layerCode === 'bgdc_dltb_2022' ? page(1, [{ guid: guid(5) }]) : page(0, [])
    );
    mockDetail();
    const { owner, send } = setup(13.99);

    send(click(), [rendered(DLTB, 1)]);

    await vi.waitFor(() => expect(owner.state.value).toMatchObject({ candidate: { guid: guid(5), origin: 'server' } }));
    expect(requests.map(({ layerCode }) => layerCode)).toStrictEqual(['bgdc_czcdyd_2022', 'bgdc_dltb_2022']);
  });

  it('三维没有渲染要素：14 级以上能后端识别的资源仍查后端', async () => {
    const requests = mockIdentify(layerCode =>
      layerCode === 'bgdc_dltb_2022' ? page(2, [{ guid: guid(1) }, { guid: guid(2) }]) : page(0, [])
    );
    const { owner, send } = setup(16);

    send(click(), [], '3d');

    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(requests.map(({ layerCode }) => layerCode)).toStrictEqual(['bgdc_czcdyd_2022', 'bgdc_dltb_2022']);
  });

  it('点击位置没有要素时为 empty', async () => {
    mockIdentify(() => page(0, []));
    const { owner, send } = setup(12);

    send(click());

    await vi.waitFor(() => expect(kindOf(owner)).toBe('empty'));
  });

  it('查后端出错时为 failed，重试从失败的资源继续，上面的资源不再查', async () => {
    let failing = true;
    const requests = mockIdentify(layerCode => {
      if (layerCode === 'bgdc_dltb_2022' && failing) {
        return FAILURE;
      }
      return layerCode === 'bgdc_dltb_2022' ? page(2, [{ guid: guid(1) }, { guid: guid(2) }]) : page(0, []);
    });
    const { owner, send } = setup(12);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('failed'));
    expect(owner.state.value).toMatchObject({ target: { layerCode: 'bgdc_dltb_2022' }, error: { message: '系统异常' } });

    failing = false;
    owner.retry();

    expect(kindOf(owner)).toBe('identifying');
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(requests.map(({ layerCode }) => layerCode)).toStrictEqual([
      'bgdc_czcdyd_2022',
      'bgdc_dltb_2022',
      'bgdc_dltb_2022'
    ]);
  });

  it('新的点击作废上一次识别：晚到的结果不显示', async () => {
    const slow = gate();
    mockIdentify(async () => {
      await slow.opened;
      return page(1, [{ guid: guid(9) }]);
    });
    const { owner, send, camera } = setup(12);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('identifying'));

    camera.value = { ...camera.value, zoom: 15 };
    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);
    slow.open();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(kindOf(owner)).toBe('candidates');
    expect(candidatesOf(owner).map(candidate => candidate.guid)).toStrictEqual([guid(1), guid(2)]);
  });
});

describe('useFeaturePick：候选与详情', () => {
  it('从列表进入详情时记下视角，详情到了以后定位并闪烁两次；返回时回到进入前的视角', async () => {
    mockDetail();
    const { owner, send, camera, fitBounds, flyTo } = setup(15);
    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);
    const list = owner.state.value.kind === 'candidates' ? owner.state.value.list : null;
    const entered = camera.value;
    const [, second] = candidatesOf(owner);
    if (!second) {
      throw new Error('应有两个候选');
    }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    owner.choose(second);

    expect(owner.state.value).toStrictEqual({ kind: 'detail', candidate: second, back: { list, camera: entered } });
    await vi.waitFor(() => expect(fitBounds).toHaveBeenCalledWith([119.28, 33.82, 119.28, 33.82], { maxZoom: 17 }));
    const colors = [highlightColor(owner)];
    for (let step = 0; step < 4; step++) {
      vi.advanceTimersByTime(200);
      colors.push(highlightColor(owner));
    }
    expect(colors).toStrictEqual(['#ff7875', '#f5222d', '#ff7875', '#f5222d', '#f5222d']);

    camera.value = { center: [120, 32], zoom: 17, bearing: 0, pitch: 0 };
    owner.back();

    expect(owner.state.value).toStrictEqual({ kind: 'candidates', list, more: { kind: 'idle' } });
    expect(flyTo).toHaveBeenCalledWith(entered, { padding: 0 });
    expect(highlighted(owner)).toBe(false);
  });

  it('换了要素以后，上一个要素的详情不当作这个要素的', async () => {
    mockDetail();
    const { owner, send } = setup(15);
    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);
    const [first, second] = candidatesOf(owner);
    if (!first || !second) {
      throw new Error('应有两个候选');
    }
    owner.choose(first);
    await vi.waitFor(() => expect(owner.detail.value?.kind).toBe('ready'));
    owner.back();

    owner.choose(second);

    expect(owner.detail.value).toStrictEqual({ kind: 'loading' });
    expect(highlighted(owner)).toBe(false);
    await vi.waitFor(() => expect(owner.detail.value).toMatchObject({ detail: { properties: { guid: guid(2) } } }));
  });

  it('只能选择当前列表里的候选', () => {
    mockDetail();
    const { owner, send } = setup(15);
    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);
    const [stale] = candidatesOf(owner);
    if (!stale) {
      throw new Error('应有候选');
    }

    send(click(), [rendered(DLTB, 3), rendered(DLTB, 4)]);
    expect(() => owner.choose(stale)).toThrow('只能选择当前候选列表里的要素');
    send(click(), [rendered(DLTB, 5)]);
    expect(() => owner.choose(stale)).toThrow('只能选择当前候选列表里的要素');
  });

  it('只有一个候选但还有下一页时列出候选，不直接进入详情', async () => {
    // 第一页的其他记录没有 guid
    mockIdentify(layerCode =>
      layerCode === 'bgdc_dltb_2022' ? page(31, [{ guid: guid(1) }, { guid: null }]) : page(0, [])
    );
    const { owner, send } = setup(12);

    send(click());

    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(candidatesOf(owner)).toHaveLength(1);
  });

  it('后端结果多于一页时可以加载更多：已经列出的不重复，失败后可以再加载，加载完不再请求', async () => {
    let failing = true;
    const records = Array.from({ length: 32 }, (_, index) => ({ guid: guid(index) }));
    const requests = mockIdentify((layerCode, pageNum) => {
      if (layerCode !== 'bgdc_dltb_2022') {
        return page(0, []);
      }
      if (pageNum === 2 && failing) {
        return FAILURE;
      }
      // 第二页和第一页的最后一条重复
      return page(32, pageNum === 1 ? records.slice(0, 30) : records.slice(29));
    });
    const { owner, send } = setup(12);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(owner.state.value).toMatchObject({ list: { pages: { loaded: 1, total: 32 } } });
    const listId = listIdOf(owner);

    owner.loadMore();
    owner.loadMore();

    expect(owner.state.value).toMatchObject({ more: { kind: 'loading' } });
    await vi.waitFor(() => expect(owner.state.value).toMatchObject({ more: { kind: 'failed' } }));
    failing = false;
    owner.loadMore();
    await vi.waitFor(() => expect(candidatesOf(owner)).toHaveLength(32));
    expect(owner.state.value).toMatchObject({ list: { pages: { loaded: 2, total: 32 } }, more: { kind: 'idle' } });
    expect(candidatesOf(owner).map(candidate => candidate.guid)).toStrictEqual(records.map(record => record.guid));
    // 加载更多是同一份列表，面板据此保留滚动位置
    expect(listIdOf(owner)).toBe(listId);

    owner.loadMore();
    const pageNums = requests.filter(({ layerCode }) => layerCode === 'bgdc_dltb_2022').map(({ pageNum }) => pageNum);
    expect(pageNums).toStrictEqual([1, 2, 2]);

    // 再点一次是新一轮，列表换了身份
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(listIdOf(owner)).not.toBe(listId);
  });

  it('不能查详情的资源：属性用候选的，不查询、不高亮、不定位', () => {
    const { owner, send, fitBounds } = setup(15);
    send(click(), [rendered(SZY, 1), rendered(SZY, 2)]);
    const [first] = candidatesOf(owner);
    if (!first) {
      throw new Error('应有候选');
    }

    owner.choose(first);
    owner.locate();

    expect(owner.detail.value).toStrictEqual({ kind: 'unsupported' });
    expect(highlighted(owner)).toBe(false);
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('详情失败时重试重新查询；定位到要素时定位并闪烁', async () => {
    let failing = true;
    const requests = mockDetail(() => failing);
    const { owner, send, fitBounds } = setup(15);
    send(click(), [rendered(DLTB, 1)]);
    await vi.waitFor(() => expect(owner.detail.value?.kind).toBe('failed'));

    failing = false;
    owner.retry();

    await vi.waitFor(() => expect(owner.detail.value?.kind).toBe('ready'));
    expect(requests).toStrictEqual([guid(1), guid(1)]);
    expect(fitBounds).not.toHaveBeenCalled();
    owner.locate();
    expect(fitBounds).toHaveBeenCalledWith([119.28, 33.82, 119.28, 33.82], { maxZoom: 17 });
    expect(highlightColor(owner)).toBe('#ff7875');

    // 换了选择时停止闪烁
    send(click(), [rendered(DLTB, 2)]);
    await vi.waitFor(() => expect(owner.detail.value?.kind).toBe('ready'));
    expect(highlightColor(owner)).toBe('#f5222d');
  });

  it('从列表选中后马上点中别的要素：不再按上一次选中定位', async () => {
    mockDetail();
    const { owner, send, fitBounds } = setup(15);
    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);
    const [first] = candidatesOf(owner);
    if (!first) {
      throw new Error('应有候选');
    }

    owner.choose(first);
    send(click(), [rendered(DLTB, 3)]);

    await vi.waitFor(() => expect(owner.detail.value?.kind).toBe('ready'));
    expect(selectedGuid(owner)).toBe(guid(3));
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe('useFeaturePick：清除', () => {
  it('Esc、离开点选工具时清除，会话的选择跟着清除', async () => {
    mockDetail();
    const { owner, send, pick, select } = setup(15);
    send(click(), [rendered(DLTB, 1)]);
    await nextTick();
    expect(select).toHaveBeenLastCalledWith([{ sourceId: DLTB, featureId: guid(1) }]);

    expect(send({ type: 'key', key: 'Escape' })).toBe(true);

    expect(kindOf(owner)).toBe('idle');
    await nextTick();
    expect(select).toHaveBeenLastCalledWith([]);

    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);
    pick.deactivate?.();
    expect(kindOf(owner)).toBe('idle');
  });

  it('关闭作废进行中的识别：晚到的结果不显示', async () => {
    const slow = gate();
    mockIdentify(async () => {
      await slow.opened;
      return page(1, [{ guid: guid(1) }]);
    });
    const { owner, send } = setup(12);
    send(click());

    owner.close();
    slow.open();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(kindOf(owner)).toBe('idle');
  });

  it('选中的资源取消勾选、换年份时清除；改透明度不影响；顺序变了时不能再返回列表', async () => {
    const { owner, send, resources } = setup(15);
    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);

    resources.state.value = withDisplay(resources.state.value, 'bgdc_dltb', { opacity: 0.5 });
    await nextTick();
    expect(kindOf(owner)).toBe('candidates');
    const [first] = candidatesOf(owner);
    if (!first) {
      throw new Error('应有候选');
    }
    owner.choose(first);
    // 目录重新合并时顺序数组换了，内容没变
    resources.state.value = { ...resources.state.value, order: [...resources.state.value.order] };
    await nextTick();
    expect(kindOf(owner)).toBe('detail');
    expect(backOf(owner)).not.toBeNull();

    resources.state.value = { ...resources.state.value, order: resources.state.value.order.toReversed() };
    await nextTick();
    expect(kindOf(owner)).toBe('detail');
    expect(backOf(owner)).toBeNull();

    resources.state.value = withDisplay(resources.state.value, 'bgdc_dltb', { checked: false });
    await nextTick();
    expect(kindOf(owner)).toBe('idle');

    resources.state.value = STATE;
    send(click(), [rendered('resources-bgdc_czcdyd', 1)]);
    expect(kindOf(owner)).toBe('detail');
    resources.state.value = withDisplay(resources.state.value, 'bgdc_czcdyd', { year: 2021 });
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
  });

  it('识别中参与识别的资源变了时作废，只改透明度不影响', async () => {
    mockIdentify(() => new Promise(() => {}));
    const { owner, send, resources } = setup(12);
    send(click());

    resources.state.value = withDisplay(resources.state.value, 'szy_kt', { opacity: 0.3 });
    await nextTick();
    expect(kindOf(owner)).toBe('identifying');
    resources.state.value = withDisplay(resources.state.value, 'szy_kt', { checked: false });
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
  });
});

function pointer(type: MapPointerEvent['type'], { x, y }: ScreenPoint, button = 0): MapPointerEvent {
  const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
  return { type, point: { x, y }, button, clickCount: 1, modifiers };
}

const FROM: ScreenPoint = { x: 100, y: 100 };
const TO: ScreenPoint = { x: 200, y: 160 };

type Send = ReturnType<typeof setup>['send'];

// 从 FROM 拖到 TO 松手，松手时框里有这些渲染要素
function dragBox(send: Send, features: readonly RenderedFeature[] = [], kind: ViewKind = '2d') {
  send(pointer('down', FROM));
  send(pointer('move', TO));
  return send(pointer('up', TO), features, kind);
}

const manyOf = (sourceId: string, n: number) => Array.from({ length: n }, (_, index) => rendered(sourceId, index));

function layerIds(owner: Owner): string[] {
  return owner.deriveGroup().layers.map(({ id }) => id);
}

describe('useFeaturePick：框选', () => {
  it('点选工具关掉拖动平移和 Shift 框选放大', () => {
    const { pick } = setup(15);

    expect(pick.gestures).toStrictEqual({ dragPan: false, boxZoom: false });
  });

  it('拖动不小于 3 像素开始框选，浮层显示框；松手后按框识别，这次手势派生的单击不识别', () => {
    const { owner, send } = setup(15);
    // 右键拖动不框选
    send(pointer('down', FROM, 2));
    send(pointer('move', TO));
    expect(owner.boxDraft.value).toBeNull();

    send(pointer('down', FROM));
    send(pointer('move', { x: 102, y: 100 }));
    expect(owner.boxDraft.value).toBeNull();
    send(pointer('move', { x: 103, y: 100 }));
    expect(owner.boxDraft.value).toStrictEqual({ from: FROM, to: { x: 103, y: 100 } });
    send(pointer('move', TO));
    expect(owner.boxDraft.value).toStrictEqual({ from: FROM, to: TO });

    expect(send(pointer('up', TO), [rendered(DLTB, 1), rendered(DLTB, 2)])).toBe(true);
    expect(owner.boxDraft.value).toBeNull();
    expect(owner.state.value).toMatchObject({ kind: 'candidates', list: { mode: 'box', pages: null } });
    expect(candidatesOf(owner).map(candidate => candidate.guid)).toStrictEqual([guid(1), guid(2)]);

    expect(send(click(200, 160), [rendered(DLTB, 3)])).toBe(false);
    expect(candidatesOf(owner)).toHaveLength(2);
  });

  it('下一次按下后单击恢复', () => {
    mockDetail();
    const { owner, send } = setup(15);
    dragBox(send, [rendered(DLTB, 1), rendered(DLTB, 2)]);

    send(pointer('down', FROM));
    send(pointer('up', FROM));
    send(click(100, 100), [rendered(DLTB, 3)]);

    expect(selectedGuid(owner)).toBe(guid(3));
  });

  it('Esc 先取消正在画的框、不改变已有的结果，松手也不再识别；没有手势时关闭', () => {
    const { owner, send } = setup(15);
    dragBox(send, [rendered(DLTB, 1), rendered(DLTB, 2)]);
    send(pointer('down', FROM));
    send(pointer('move', TO));

    send({ type: 'key', key: 'Escape' });

    expect(owner.boxDraft.value).toBeNull();
    expect(send(pointer('up', TO), [rendered(DLTB, 5)])).toBe(false);
    expect(candidatesOf(owner)).toHaveLength(2);
    send({ type: 'key', key: 'Escape' });
    expect(kindOf(owner)).toBe('idle');
  });

  it('离开画布、地图移动、窗口失焦时取消这次框选', async () => {
    const { owner, send, camera } = setup(15);
    const startDrawing = () => {
      send(pointer('down', FROM));
      send(pointer('move', TO));
      expect(owner.boxDraft.value).not.toBeNull();
    };

    startDrawing();
    send(pointer('leave', TO));
    expect(owner.boxDraft.value).toBeNull();

    startDrawing();
    camera.value = { ...camera.value, zoom: 15.5 };
    await nextTick();
    expect(owner.boxDraft.value).toBeNull();

    startDrawing();
    window.dispatchEvent(new Event('blur'));
    expect(owner.boxDraft.value).toBeNull();
    expect(send(pointer('up', TO), [rendered(DLTB, 1)])).toBe(false);
    expect(kindOf(owner)).toBe('idle');
  });

  it('拖动途中关闭或离开点选工具时，正在画的框消失', () => {
    const { owner, send, pick } = setup(15);

    send(pointer('down', FROM));
    send(pointer('move', TO));
    owner.close();
    expect(owner.boxDraft.value).toBeNull();

    send(pointer('down', FROM));
    send(pointer('move', TO));
    pick.deactivate?.();
    expect(owner.boxDraft.value).toBeNull();
  });

  it('框里只有一个要素时直接进入详情，不移动相机', () => {
    mockDetail();
    const { owner, send, beginCameraOperation } = setup(15);

    dragBox(send, [rendered(DLTB, 1)]);

    expect(selectedGuid(owner)).toBe(guid(1));
    expect(beginCameraOperation).not.toHaveBeenCalled();
  });

  it('框里的渲染要素去重后超过 5000 个时提示缩小范围，不请求后端', async () => {
    const requests = mockIdentify(() => page(0, []));
    const { owner, send } = setup(15);

    dragBox(send, manyOf(DLTB, 5001));
    expect(owner.state.value).toMatchObject({ kind: 'too-many', target: { sourceId: DLTB }, estimate: 5001 });

    // 低级别能后端识别的资源超过上限时同样不请求
    const lower = setup(12);
    dragBox(lower.send, manyOf(CZCDYD, 5001));
    expect(lower.owner.state.value).toMatchObject({ kind: 'too-many', target: { sourceId: CZCDYD } });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(requests).toStrictEqual([]);
  });

  it('14 级以下登记的数据集查后端：框的四角拾取成多边形，按页加载', async () => {
    const records = Array.from({ length: 30 }, (_, index) => ({ guid: guid(index + 1) }));
    const requests = mockIdentify((layerCode, pageNum) => {
      if (layerCode !== 'bgdc_dltb_2022') {
        return page(0, []);
      }
      return pageNum === 1 ? page(45, records) : page(45, [{ guid: guid(99) }]);
    });
    const { owner, send } = setup(12);

    dragBox(send);

    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(owner.state.value).toMatchObject({ list: { mode: 'box', pages: { loaded: 1, total: 45 } } });
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [118.1, 32.9],
          [118.2, 32.9],
          [118.2, 32.84],
          [118.1, 32.84],
          [118.1, 32.9]
        ]
      ]
    };
    expect(requests.map(({ layerCode, geometry }) => [layerCode, geometry])).toStrictEqual([
      ['bgdc_czcdyd_2022', polygon],
      ['bgdc_dltb_2022', polygon]
    ]);
    owner.loadMore();
    await vi.waitFor(() => expect(candidatesOf(owner)).toHaveLength(31));
  });

  it('三维视图：能后端识别的资源仍查后端', async () => {
    const requests = mockIdentify(layerCode =>
      layerCode === 'bgdc_dltb_2022' ? page(2, [{ guid: guid(1) }, { guid: guid(2) }]) : page(0, [])
    );
    const { owner, send } = setup(16);

    dragBox(send, [], '3d');

    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(requests.map(({ layerCode }) => layerCode)).toStrictEqual(['bgdc_czcdyd_2022', 'bgdc_dltb_2022']);
  });

  it('框选列表时会话选中列表里的全部要素，进入一个的详情时只有它，返回后恢复；单击的列表不算选中', async () => {
    mockDetail();
    const { owner, send, select } = setup(15);
    const both = [
      { sourceId: DLTB, featureId: guid(1) },
      { sourceId: DLTB, featureId: guid(2) }
    ];

    dragBox(send, [rendered(DLTB, 1), rendered(DLTB, 2)]);
    await nextTick();
    expect(select).toHaveBeenLastCalledWith(both);

    const [first] = candidatesOf(owner);
    if (!first) {
      throw new Error('应有候选');
    }
    owner.choose(first);
    await nextTick();
    expect(select).toHaveBeenLastCalledWith([both[0]]);
    owner.back();
    await nextTick();
    expect(select).toHaveBeenLastCalledWith(both);

    send(pointer('down', FROM));
    send(pointer('up', FROM));
    send(click(100, 100), [rendered(DLTB, 3), rendered(DLTB, 4)]);
    await nextTick();
    expect(select).toHaveBeenLastCalledWith([]);
  });

  it('批量高亮：框选列表时在资源的瓦片上按 guid 过滤，进入详情时收起、返回后恢复', () => {
    mockDetail();
    const { owner, send } = setup(15);
    dragBox(send, [rendered(DLTB, 1), rendered(DLTB, 2)]);

    const group = owner.deriveGroup();
    expect(group.sources).toStrictEqual({});
    expect(group.layers.map(({ id }) => id)).toStrictEqual([
      'selection-batch-fill',
      'selection-batch-line',
      'selection-batch-circle'
    ]);
    expect(group.layers[0]).toMatchObject({
      source: DLTB,
      'source-layer': 'bgdc_dltb_2022',
      filter: ['all', expect.anything(), ['match', ['get', 'guid'], [guid(1), guid(2)], true, false]]
    });

    const [first] = candidatesOf(owner);
    if (!first) {
      throw new Error('应有候选');
    }
    owner.choose(first);
    expect(layerIds(owner)).toStrictEqual([]);
    owner.back();
    expect(layerIds(owner)).toHaveLength(3);

    // 单击得到的列表不批量高亮
    send(pointer('down', FROM));
    send(pointer('up', FROM));
    send(click(100, 100), [rendered(DLTB, 3), rendered(DLTB, 4)]);
    expect(kindOf(owner)).toBe('candidates');
    expect(layerIds(owner)).toStrictEqual([]);
  });

  it('提示要素过多时，这个资源取消勾选就清除', async () => {
    const { owner, send, resources } = setup(15);
    dragBox(send, manyOf(DLTB, 5001));

    resources.state.value = withDisplay(resources.state.value, 'szy_kt', { opacity: 0.4 });
    await nextTick();
    expect(kindOf(owner)).toBe('too-many');
    resources.state.value = withDisplay(resources.state.value, 'bgdc_dltb', { checked: false });
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
  });

  it('资源不再显示时批量高亮立刻不出图层，不等列表清除，和资源分组一起变化', () => {
    const { owner, send, resources } = setup(15);
    dragBox(send, [rendered(DLTB, 1), rendered(DLTB, 2)]);

    resources.state.value = withDisplay(resources.state.value, 'bgdc_dltb', { checked: false });

    expect(kindOf(owner)).toBe('candidates');
    expect(layerIds(owner)).toStrictEqual([]);
  });

  it('列表显示期间资源被校验拦下时不出批量高亮；别的资源被拦下不影响', () => {
    const { owner, send, resources } = setup(15);
    dragBox(send, [rendered(DLTB, 1), rendered(DLTB, 2)]);

    resources.errors.value = new Map([['bgdc_czcdyd', ['图层不合法']]]);
    expect(layerIds(owner)).toHaveLength(3);
    resources.errors.value = new Map([['bgdc_dltb', ['图层不合法']]]);
    expect(layerIds(owner)).toStrictEqual([]);
  });
});

describe('hasMorePages', () => {
  it('已加载的页数乘每页条数小于总数时还有更多', () => {
    const geometry: Point = { type: 'Point', coordinates: [119, 33] };
    expect(hasMorePages(null)).toBe(false);
    expect(hasMorePages({ geometry, loaded: 1, total: 31 })).toBe(true);
    expect(hasMorePages({ geometry, loaded: 1, total: 30 })).toBe(false);
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

// 带几何的渲染要素：区划裁剪时按几何判断在不在范围里
function shapedAt(sourceId: string, id: number, geometry: Polygon): RenderedFeature {
  return { ...rendered(sourceId, id), geometry };
}

// 区划盖住单击位置 (118.1, 32.9) 和框（118.1～118.2、32.84～32.9）的左半边
const SCOPE: RegionScope = rect(118, 32.8, 118.15, 33);

// 同样的区划挖了 40 个小洞，和框求交后坐标太多，简化也压不下来
const HOLED: RegionScope = {
  type: 'Polygon',
  coordinates: [
    SCOPE.type === 'Polygon' ? (SCOPE.coordinates[0] ?? []) : [],
    ...Array.from({ length: 40 }, (_, index) => {
      const [x, y] = [118.102 + (index % 8) * 0.005, 32.842 + Math.floor(index / 8) * 0.01];
      return (rect(x, y, x + 0.001, y + 0.001).coordinates[0] ?? []).toReversed();
    })
  ]
};

describe('useFeaturePick：区划裁剪（ADR 0051）', () => {
  it('单击在区划外（遮罩上）时关闭现有的结果、不识别；区划里照常，区划外的渲染要素不算', () => {
    const { owner, send } = setup(15, STATE, new Map(), SCOPE);
    send(click(100, 100), [
      shapedAt(DLTB, 1, rect(118.09, 32.89, 118.11, 32.91)),
      shapedAt(DLTB, 2, rect(118.09, 32.89, 118.11, 32.91)),
      shapedAt(DLTB, 3, rect(118.2, 32.89, 118.3, 32.91))
    ]);
    expect(candidatesOf(owner).map(({ guid: id }) => id)).toStrictEqual([guid(1), guid(2)]);

    send(click(300, 100), [shapedAt(DLTB, 3, rect(118.2, 32.89, 118.4, 32.91))]);
    expect(kindOf(owner)).toBe('idle');
  });

  it('框整个在区划外时关闭现有的结果', () => {
    const { owner, send } = setup(15, STATE, new Map(), rect(118.5, 32.8, 118.6, 33));
    send(click(550, 100), [
      shapedAt(DLTB, 1, rect(118.54, 32.89, 118.56, 32.91)),
      shapedAt(DLTB, 2, rect(118.54, 32.89, 118.56, 32.91))
    ]);
    expect(kindOf(owner)).toBe('candidates');

    dragBox(send, [shapedAt(DLTB, 3, rect(118.12, 32.85, 118.13, 32.86))]);
    expect(kindOf(owner)).toBe('idle');
  });

  it('查后端时用框和区划求交后的范围', async () => {
    const requests = mockIdentify(layerCode =>
      layerCode === 'bgdc_dltb_2022' ? page(1, [{ guid: guid(1) }]) : page(0, [])
    );
    mockDetail();
    const { owner, send } = setup(12, STATE, new Map(), SCOPE);

    dragBox(send);

    await vi.waitFor(() => expect(kindOf(owner)).toBe('detail'));
    const [first] = requests;
    expect(first?.geometry && bbox(first.geometry as Polygon)).toStrictEqual([118.1, 32.84, 118.15, 32.9]);
  });

  it('求交范围整理不出来时提示范围太复杂，不请求后端；这个资源取消勾选就清除', async () => {
    const requests = mockIdentify(() => page(0, []));
    const { owner, send, resources } = setup(12, STATE, new Map(), HOLED);

    dragBox(send);

    expect(owner.state.value).toMatchObject({ kind: 'too-complex', target: { sourceId: CZCDYD }, mode: 'box' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(requests).toStrictEqual([]);
    resources.state.value = withDisplay(resources.state.value, 'bgdc_czcdyd', { checked: false });
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
  });

  it('换区划、回到全省、边界加载完成时关闭结果', async () => {
    const twoParcels = [
      shapedAt(DLTB, 1, rect(118.09, 32.89, 118.11, 32.91)),
      shapedAt(DLTB, 2, rect(118.09, 32.89, 118.11, 32.91))
    ];
    const { owner, send, scope } = setup(15);
    send(click(100, 100), twoParcels);
    expect(kindOf(owner)).toBe('candidates');

    scope.value = SCOPE;
    await nextTick();
    expect(kindOf(owner)).toBe('idle');

    send(click(100, 100), twoParcels);
    scope.value = rect(117, 32, 119, 34);
    await nextTick();
    expect(kindOf(owner)).toBe('idle');

    send(click(100, 100), twoParcels);
    scope.value = null;
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
  });
});

describe('useFeaturePick：年份变化（ADR 0052 第 4 节）', () => {
  it('批量设置没改到当前结果的资源时保留结果，改到时关闭', async () => {
    const { owner, send, resources } = setup(15);
    send(click(), [rendered(DLTB, 1), rendered(DLTB, 2)]);

    // 地类图斑只有 2022 年，批量设成 2021 只改到城镇村等用地
    resources.state.value = withYearForAll(resources.state.value, 2021);
    await nextTick();
    expect(kindOf(owner)).toBe('candidates');

    send(click(), [rendered(CZCDYD, 1), rendered(CZCDYD, 2)]);
    expect(owner.state.value).toMatchObject({ kind: 'candidates', list: { target: { year: 2021 } } });
    resources.state.value = withYearForAll(resources.state.value, 2022);
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
  });

  it('识别进行中换年份：作废，晚到的结果不显示、不定位', async () => {
    const slow = gate();
    mockIdentify(async () => {
      await slow.opened;
      return page(1, [{ guid: guid(9) }]);
    });
    mockDetail();
    const { owner, send, resources, fitBounds } = setup(12);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('identifying'));

    resources.state.value = withYearForAll(resources.state.value, 2021);
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
    slow.open();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(kindOf(owner)).toBe('idle');
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('加载更多进行中换年份：关闭列表，晚到的一页不出现', async () => {
    const slow = gate();
    const records = Array.from({ length: 32 }, (_, index) => ({ guid: guid(index) }));
    mockIdentify(async (layerCode, pageNum) => {
      if (layerCode !== 'bgdc_czcdyd_2022') {
        return page(0, []);
      }
      if (pageNum === 2) {
        await slow.opened;
      }
      return page(32, pageNum === 1 ? records.slice(0, 30) : records.slice(30));
    });
    const { owner, send, resources } = setup(12);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    owner.loadMore();
    expect(owner.state.value).toMatchObject({ more: { kind: 'loading' } });

    resources.state.value = withYearForAll(resources.state.value, 2021);
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
    slow.open();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(kindOf(owner)).toBe('idle');
  });

  it('详情请求进行中换年份：关闭详情，晚到的详情不高亮、不定位', async () => {
    const slow = gate();
    server.use(
      mock.get('/backend/api/query/attr/page', async ({ request }) => {
        await slow.opened;
        return HttpResponse.json(page(1, [{ guid: guidOf(request), name: '详情' }]));
      }),
      mock.get('/backend/api/query/scope/geojson', async ({ request }) => {
        await slow.opened;
        return HttpResponse.json([{ guid: guidOf(request), geom: JSON.stringify(POINT) }]);
      })
    );
    const { owner, send, resources, fitBounds } = setup(15);
    send(click(), [rendered(CZCDYD, 1), rendered(CZCDYD, 2)]);
    const [first] = candidatesOf(owner);
    if (!first) {
      throw new Error('应有候选');
    }
    owner.choose(first);
    expect(owner.detail.value?.kind).toBe('loading');

    resources.state.value = withYearForAll(resources.state.value, 2021);
    await nextTick();
    expect(kindOf(owner)).toBe('idle');
    slow.open();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(kindOf(owner)).toBe('idle');
    expect(highlighted(owner)).toBe(false);
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

// 同一处点中的两个渲染要素
const twoRoads = (first: number) => [rendered(DLTB, first), rendered(DLTB, first + 1)];

describe('useFeaturePick：被面板挡住时露出来（设计稿 5D.6）', () => {
  it('单击点中一个渲染要素：面板按结果渲染以后让点中的位置露出来，不定位', async () => {
    mockDetail();
    const { send, reveal, fitBounds } = setup(15);

    send(click(), [rendered(DLTB, 1)]);
    expect(reveal).not.toHaveBeenCalled();
    await nextTick();

    expect(reveal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith([118.1, 32.9]);
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('单击点中多个渲染要素：列出候选后露出来', async () => {
    const { send, reveal } = setup(15);

    send(click(200, 100), twoRoads(1));
    await nextTick();

    expect(reveal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith([118.2, 32.9]);
  });

  it('后端识别出多个：用等待之前开始的那次相机操作露出来', async () => {
    mockIdentify(layerCode =>
      layerCode === 'bgdc_dltb_2022' ? page(2, [{ guid: guid(1) }, { guid: guid(2) }]) : page(0, [])
    );
    const { owner, send, reveal, beginCameraOperation } = setup(12);

    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    await nextTick();

    expect(reveal).toHaveBeenCalledWith([118.1, 32.9]);
    expect(beginCameraOperation).toHaveBeenCalledOnce();
  });

  it('框选、没有结果、后端识别出一个（要定位）时不露出来', async () => {
    mockIdentify(layerCode => (layerCode === 'bgdc_dltb_2022' ? page(1, [{ guid: guid(7) }]) : page(0, [])));
    mockDetail();
    const boxed = setup(15);
    dragBox(boxed.send, twoRoads(1));
    expect(kindOf(boxed.owner)).toBe('candidates');
    const empty = setup(15);
    empty.send(click(), []);
    expect(kindOf(empty.owner)).toBe('empty');
    await nextTick();
    expect(boxed.reveal).not.toHaveBeenCalled();
    expect(empty.reveal).not.toHaveBeenCalled();

    const far = setup(12);
    far.send(click());
    await vi.waitFor(() => expect(far.fitBounds).toHaveBeenCalledOnce());
    expect(far.reveal).not.toHaveBeenCalled();
  });

  it('面板渲染之前关闭了结果、用户移动了地图、又点了别处：这一次不露出来', async () => {
    const { owner, send, reveal, interrupt } = setup(15);

    send(click(), twoRoads(1));
    owner.close();
    await nextTick();
    send(click(), twoRoads(1));
    interrupt();
    await nextTick();
    expect(reveal).not.toHaveBeenCalled();

    send(click(100, 100), twoRoads(1));
    send(click(300, 100), twoRoads(3));
    await nextTick();
    expect(reveal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith([118.3, 32.9]);
  });
});

describe('useFeaturePick：和其他操作的交错', () => {
  it('后端识别等待期间发起了别的定位（默认视角、坐标定位）：识别晚到的单个结果不再定位', async () => {
    const slow = gate();
    mockIdentify(async layerCode => {
      await slow.opened;
      return layerCode === 'bgdc_dltb_2022' ? page(1, [{ guid: guid(1) }]) : page(0, []);
    });
    mockDetail();
    const { owner, send, fitBounds, flyTo, runCameraOperation } = setup(12);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('identifying'));

    runCameraOperation(control => control.flyTo({ center: [119, 33], zoom: 8 }));
    slow.open();
    await vi.waitFor(() => expect(owner.detail.value?.kind).toBe('ready'));

    expect(flyTo).toHaveBeenCalledOnce();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('规划本身出错（如几何求交）：先作废上一轮识别，显示失败，可以重试；上一轮晚到的结果不出现', async () => {
    const slow = gate();
    mockIdentify(async layerCode => {
      await slow.opened;
      return layerCode === 'bgdc_dltb_2022' ? page(1, [{ guid: guid(1) }]) : page(0, []);
    });
    mockDetail();
    const { owner, send, pick } = setup(12);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('identifying'));

    // 第二次单击时规划抛错，第一次抛错后恢复正常
    let failing = true;
    const view = toolView([], '2d');
    const flaky: ToolView = {
      ...view,
      queryRendered: (area, options) => {
        if (failing) {
          failing = false;
          throw new Error('求交失败');
        }
        return view.queryRendered(area, options);
      }
    };
    expect(() => pick.handleInput?.(click(), flaky)).not.toThrow();
    expect(owner.state.value).toMatchObject({ kind: 'failed', target: null });
    slow.open();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(owner.state.value).toMatchObject({ kind: 'failed', target: null });

    owner.retry();
    await vi.waitFor(() => expect(kindOf(owner)).toBe('detail'));
  });

  it('加载更多进行中开始新一轮识别：晚到的一页不进入新的列表', async () => {
    const slow = gate();
    const records = Array.from({ length: 32 }, (_, index) => ({ guid: guid(index) }));
    mockIdentify(async (layerCode, pageNum) => {
      if (layerCode !== 'bgdc_czcdyd_2022') {
        return page(0, []);
      }
      if (pageNum === 2) {
        await slow.opened;
      }
      return page(32, pageNum === 1 ? records.slice(0, 30) : records.slice(30));
    });
    const { owner, send } = setup(12);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    const firstRound = listIdOf(owner);
    owner.loadMore();
    expect(owner.state.value).toMatchObject({ more: { kind: 'loading' } });

    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(listIdOf(owner)).not.toBe(firstRound);
    expect(owner.state.value).toMatchObject({ list: { pages: { loaded: 1 } }, more: { kind: 'idle' } });
    slow.open();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(candidatesOf(owner)).toHaveLength(30);
    expect(owner.state.value).toMatchObject({ list: { pages: { loaded: 1 } }, more: { kind: 'idle' } });
  });

  it('没有别的定位时，后端识别出的单个要素照常定位', async () => {
    mockIdentify(layerCode => (layerCode === 'bgdc_dltb_2022' ? page(1, [{ guid: guid(1) }]) : page(0, [])));
    mockDetail();
    const { owner, send, fitBounds } = setup(12);
    send(click());

    await vi.waitFor(() => expect(owner.detail.value?.kind).toBe('ready'));
    expect(fitBounds).toHaveBeenCalledOnce();
  });
});
