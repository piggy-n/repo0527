import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import type { Point } from 'geojson';
import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import type { CameraState, MapInputEvent, MapPointerEvent, RenderedFeature, ToolView } from '@yzt/map-core';
import type { CameraControl, CameraOperation, MapContext } from '@yzt/map-vue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, shallowRef } from 'vue';
import { FEATURE_PICK_TOOL } from '@/shared/map/toolbar/toolbar-items';
import type { ResourceTreeCategory, ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import type { PickCandidate } from '../feature-query';
import type { ResourceDisplay, ResourceLayersState } from '../resource-layers';
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
      layer('csxhjctb_hydl', 'Line', 2024),
      // 9 级起显示
      layer('bgdc_cjdcq', 'Polygon', 2023, 2024),
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

// 从上到下：水域线（不能后端识别）、村级调查区、地类图斑、坑塘（不能查询）
const STATE: ResourceLayersState = {
  catalog: CATALOG,
  displays: new Map([
    ['csxhjctb_hydl', display(2024)],
    ['bgdc_cjdcq', display(2023)],
    ['bgdc_dltb', display(2022)],
    ['szy_kt', display(2025)]
  ]),
  order: ['csxhjctb_hydl', 'bgdc_cjdcq', 'bgdc_dltb', 'szy_kt']
};

// 村级调查区不勾选：14 级起上面没有能后端识别、又没有渲染要素的资源，点中渲染要素时不查后端
const RENDERED_STATE = withDisplay(STATE, 'bgdc_cjdcq', { checked: false });

const DLTB = 'resources-bgdc_dltb';
const SZY = 'resources-szy_kt';

const guid = (index: number) => index.toString(16).padStart(32, '0');
const POINT = { type: 'Point', coordinates: [119.28, 33.82] };
const page = (total: number, list: unknown[]) => ({ total, list, pageNum: 1, pages: 1 });
const FAILURE = { success: false, code: 500, data: null, msg: '系统异常' };

function rendered(sourceId: string, id: number): RenderedFeature {
  return { sourceId, layerId: sourceId, properties: { guid: guid(id), name: `要素 ${id}` } };
}

// 拾取：每像素 0.001 度，画布左上角是 (118, 33)；渲染要素按数据源返回给定的
function toolView(features: readonly RenderedFeature[]): ToolView {
  return {
    kind: '2d',
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
  let current = new AbortController();
  const beginCameraOperation = vi.fn<() => CameraOperation>(() => {
    current.abort();
    const controller = new AbortController();
    current = controller;
    return {
      signal: controller.signal,
      run: action => {
        if (!controller.signal.aborted) {
          action({ fitBounds, flyTo });
        }
      }
    };
  });
  const runCameraOperation = vi.fn<MapContext['runCameraOperation']>(action => beginCameraOperation().run(action));
  return { camera, fitBounds, flyTo, beginCameraOperation, runCameraOperation, interrupt: () => current.abort() };
}

function setup(zoom = 15, state = RENDERED_STATE, invalid: ReadonlyMap<string, readonly string[]> = new Map()) {
  const fake = fakeCamera(zoom);
  const select = vi.fn<MapContext['select']>();
  const map = { useCamera: () => fake.camera, select, ...fake };
  const resources = { state: shallowRef(state), configErrors: computed(() => invalid) };
  let owner: FeaturePick | undefined;
  const Host = defineComponent({
    setup() {
      owner = useFeaturePick(map, resources);
      return () => null;
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  if (!owner) {
    throw new Error('没有创建选择的拥有者');
  }
  const pick = owner.tools[FEATURE_PICK_TOOL];
  const send = (event: MapInputEvent, features: readonly RenderedFeature[] = []) =>
    pick.handleInput?.(event, toolView(features));
  return { owner, pick, send, select, resources, ...fake };
}

type Owner = ReturnType<typeof setup>['owner'];

const kindOf = (owner: Owner) => owner.state.value.kind;

function candidatesOf(owner: Owner): readonly PickCandidate[] {
  const state = owner.state.value;
  return state.kind === 'candidates' ? state.list.candidates : [];
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
  it('14 级起点中一个渲染要素：直接进入详情，不移动相机；会话记下选中的要素，详情到了以后高亮', async () => {
    mockDetail();
    const { owner, send, select, beginCameraOperation, fitBounds } = setup(15);

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
    expect(beginCameraOperation).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
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
    const { owner, send, fitBounds } = setup(12, STATE);

    send(click(100, 100));

    expect(kindOf(owner)).toBe('identifying');
    await vi.waitFor(() => expect(kindOf(owner)).toBe('detail'));
    expect(requests).toStrictEqual([
      { layerCode: 'bgdc_cjdcq_2023', pageNum: 1, geometry: { type: 'Point', coordinates: [118.1, 32.9] } },
      { layerCode: 'bgdc_dltb_2022', pageNum: 1, geometry: { type: 'Point', coordinates: [118.1, 32.9] } }
    ]);
    expect(owner.state.value).toMatchObject({ candidate: { guid: guid(7), origin: 'server' }, back: null });

    await vi.waitFor(() => expect(fitBounds).toHaveBeenCalledOnce());
    expect(fitBounds).toHaveBeenCalledWith([119.28, 33.82, 119.28, 33.82], { maxZoom: 17 });
  });

  it('被校验拦下的资源不参与识别', () => {
    const { owner, send } = setup(15, RENDERED_STATE, new Map([['bgdc_dltb', ['图层不合法']]]));

    send(click(), [rendered(DLTB, 1), rendered(SZY, 2)]);

    expect(owner.state.value).toMatchObject({ kind: 'detail', candidate: { target: { sourceId: SZY } } });
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
    const { owner, send } = setup(12, STATE);
    send(click());
    await vi.waitFor(() => expect(kindOf(owner)).toBe('failed'));
    expect(owner.state.value).toMatchObject({ target: { layerCode: 'bgdc_dltb_2022' }, error: { message: '系统异常' } });

    failing = false;
    owner.retry();

    expect(kindOf(owner)).toBe('identifying');
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
    expect(requests.map(({ layerCode }) => layerCode)).toStrictEqual([
      'bgdc_cjdcq_2023',
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
    mockIdentify(layerCode => (layerCode === 'bgdc_dltb_2022' ? page(31, [{ guid: guid(1) }, { guid: null }]) : page(0, [])));
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

    owner.loadMore();
    owner.loadMore();

    expect(owner.state.value).toMatchObject({ more: { kind: 'loading' } });
    await vi.waitFor(() => expect(owner.state.value).toMatchObject({ more: { kind: 'failed' } }));
    failing = false;
    owner.loadMore();
    await vi.waitFor(() => expect(candidatesOf(owner)).toHaveLength(32));
    expect(owner.state.value).toMatchObject({ list: { pages: { loaded: 2, total: 32 } }, more: { kind: 'idle' } });
    expect(candidatesOf(owner).map(candidate => candidate.guid)).toStrictEqual(records.map(record => record.guid));

    owner.loadMore();
    const pageNums = requests.filter(({ layerCode }) => layerCode === 'bgdc_dltb_2022').map(({ pageNum }) => pageNum);
    expect(pageNums).toStrictEqual([1, 2, 2]);
  });

  it('不能查详情的资源：属性用候选的，不查询、不高亮、不定位', async () => {
    // 上面的地类图斑在这里没有渲染要素，仍查后端（ADR 0047 第 2 节）
    mockIdentify(() => page(0, []));
    const { owner, send, fitBounds } = setup(15);
    send(click(), [rendered(SZY, 1), rendered(SZY, 2)]);
    await vi.waitFor(() => expect(kindOf(owner)).toBe('candidates'));
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
    send(click(), [rendered('resources-bgdc_cjdcq', 1)]);
    expect(kindOf(owner)).toBe('detail');
    resources.state.value = withDisplay(resources.state.value, 'bgdc_cjdcq', { year: 2024 });
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

describe('hasMorePages', () => {
  it('已加载的页数乘每页条数小于总数时还有更多', () => {
    const geometry: Point = { type: 'Point', coordinates: [119, 33] };
    expect(hasMorePages(null)).toBe(false);
    expect(hasMorePages({ geometry, loaded: 1, total: 31 })).toBe(true);
    expect(hasMorePages({ geometry, loaded: 1, total: 30 })).toBe(false);
  });
});
