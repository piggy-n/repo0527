// @vitest-environment node
import type { CameraState, LngLat, MapInputEvent, PickResult, ToolView } from '@yzt/map-core';
import type { MapContext, MapViewport, MapViewState } from '@yzt/map-vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, shallowRef } from 'vue';
import countyFile from '../boundary/data/jiangsu-county.json?raw';
import { findRegion } from '../region/region-catalog';
import type { RegionBoundaryLoader } from '../region/region-geometry';
import { LOCATION_PICK_TOOL, useLocationPoint } from './useLocationPoint';

const XUANWU: LngLat = [118.79786, 32.04864];
const CAMERA: CameraState = { center: [119, 32], zoom: 7, bearing: 0, pitch: 0 };
const SHANGHAI: LngLat = [121.47, 31.23];

// 只经过微任务的等待：侦听器和区县判断走完
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function pointer(type: 'move' | 'leave' | 'click' | 'down', x = 10, y = 20, button = 0, clickCount = 1): MapInputEvent {
  return {
    type,
    point: { x, y },
    button,
    clickCount,
    modifiers: { shift: false, ctrl: false, alt: false, meta: false }
  };
}

// 拾取：每像素 0.001 度，画布左上角是 (118, 33)；pick 返回 miss 时用 MISS
function toolView(result?: PickResult): ToolView {
  return {
    kind: '2d',
    pick: ({ x, y }) => result ?? { kind: 'hit', surface: 'map', lngLat: [118 + x / 1000, 33 - y / 1000] },
    project: () => null
  };
}

/** 区县判断由测试逐个放行 */
function manualRegions() {
  const pending: { lngLat: LngLat; resolve: (code: string | null) => void; reject: (error: unknown) => void }[] = [];
  const districtCodeAt = vi.fn<RegionBoundaryLoader['districtCodeAt']>(
    lngLat => new Promise((resolve, reject) => pending.push({ lngLat, resolve, reject }))
  );
  return { regions: { districtCodeAt }, pending, districtCodeAt };
}

function setup({ zoom = 10, viewState = 'ready' }: { zoom?: number; viewState?: MapViewState } = {}) {
  const flyTo = vi.fn<MapViewport['flyTo']>();
  const viewport: MapViewport = {
    kind: '2d',
    flyTo,
    fitBounds: vi.fn<MapViewport['fitBounds']>(),
    pick: vi.fn<MapViewport['pick']>(),
    project: vi.fn<MapViewport['project']>()
  };
  const camera = shallowRef<CameraState>({ center: [119, 32], zoom, bearing: 0, pitch: 0 });
  const releaseTool = vi.fn<MapContext['releaseTool']>();
  const map = {
    view: shallowRef<MapViewport | null>(viewport),
    viewState: ref<MapViewState>(viewState),
    useCamera: () => camera,
    releaseTool
  };
  const manual = manualRegions();
  const scope = effectScope();
  const owner = scope.run(() => useLocationPoint(map, { regions: manual.regions }));
  if (!owner) {
    throw new Error('没有创建位置点');
  }
  const pick = owner.tools[LOCATION_PICK_TOOL];
  const send = (event: MapInputEvent, view = toolView()) => pick.handleInput?.(event, view);
  return { owner, scope, flyTo, releaseTool, send, pick, ...manual };
}

// 还没有视图的上下文
function idleMap() {
  return {
    view: shallowRef(null),
    viewState: ref<MapViewState>('idle'),
    useCamera: () => shallowRef(CAMERA),
    releaseTool: () => {}
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useLocationPoint', () => {
  it('开始时没有位置点、位置信息关着、输入框是度分秒', () => {
    const { owner } = setup();

    expect(owner.state.value).toStrictEqual({ point: null, infoOpen: false, format: 'dms' });
    expect(owner.region.value).toStrictEqual({ kind: 'none' });
    expect(owner.pickPointer.value).toBeNull();
  });

  it('输入后定位：放下位置点，飞过去，至少放大到 14 级', () => {
    const near = setup({ zoom: 10 });
    const close = setup({ zoom: 16 });

    near.owner.locate(XUANWU);
    close.owner.locate(XUANWU);

    expect(near.owner.state.value.point).toStrictEqual({ lngLat: XUANWU, source: 'input' });
    expect(near.flyTo.mock.calls).toStrictEqual([[{ center: XUANWU, zoom: 14 }, { duration: 1000 }]]);
    expect(close.flyTo.mock.calls).toStrictEqual([[{ center: XUANWU, zoom: 16 }, { duration: 1000 }]]);
  });

  it('视图没就绪时只放下位置点，不定位', () => {
    const { owner, flyTo } = setup({ viewState: 'initializing' });

    owner.locate(XUANWU);

    expect(owner.state.value.point?.lngLat).toBe(XUANWU);
    expect(flyTo).not.toHaveBeenCalled();
  });

  it('放下或移动位置点时不移动地图；删除时连同位置信息', () => {
    const { owner, flyTo } = setup();

    owner.place(XUANWU, 'drag');
    owner.setInfoOpen(true);
    expect(owner.state.value).toStrictEqual({
      point: { lngLat: XUANWU, source: 'drag' },
      infoOpen: true,
      format: 'dms'
    });

    owner.remove();

    expect(owner.state.value).toStrictEqual({ point: null, infoOpen: false, format: 'dms' });
    expect(flyTo).not.toHaveBeenCalled();
  });

  it('输入框的格式可以切换；值没变时不替换状态', () => {
    const { owner } = setup();
    const before = owner.state.value;

    owner.setFormat('dms');
    owner.setInfoOpen(false);
    owner.remove();
    expect(owner.state.value).toBe(before);

    owner.setFormat('decimal');
    expect(owner.state.value.format).toBe('decimal');
  });

  it('拾取工具是临时任务，十字光标；鼠标位置跟着移动，离开画布或退出时清掉', () => {
    const { owner, pick, send } = setup();

    expect(pick).toMatchObject({ persistent: false, cursor: 'crosshair' });
    send(pointer('move', 30, 40));
    expect(owner.pickPointer.value).toStrictEqual({ x: 30, y: 40 });
    send(pointer('leave'));
    expect(owner.pickPointer.value).toBeNull();

    send(pointer('move', 30, 40));
    pick.deactivate?.();
    expect(owner.pickPointer.value).toBeNull();
  });

  it('单击一次：放下位置点、打开位置信息、退出拾取，地图不移动', () => {
    const { owner, send, releaseTool, flyTo } = setup();

    expect(send(pointer('click', 100, 200))).toBe(true);

    expect(owner.state.value).toStrictEqual({
      point: { lngLat: [118.1, 32.8], source: 'pick' },
      infoOpen: true,
      format: 'dms'
    });
    expect(releaseTool.mock.calls).toStrictEqual([[LOCATION_PICK_TOOL]]);
    expect(flyTo).not.toHaveBeenCalled();
  });

  it('右键、双击里的第二次单击、拾取不到时不放点也不退出；Esc 不处理，交给工具模型', () => {
    const { owner, send, releaseTool } = setup();

    expect(send(pointer('click', 10, 20, 2))).toBe(false);
    expect(send(pointer('click', 10, 20, 0, 2))).toBe(false);
    expect(send(pointer('click'), toolView({ kind: 'miss' }))).toBe(true);
    expect(send({ type: 'key', key: 'Escape' })).toBe(false);
    expect(send(pointer('down'))).toBe(false);

    expect(owner.state.value.point).toBeNull();
    expect(releaseTool).not.toHaveBeenCalled();
  });

  it('位置点变化后判断所在区县：判断中、区县、省外；没有位置点时清掉', async () => {
    const { owner, pending, districtCodeAt } = setup();

    owner.place(XUANWU, 'input');
    await settle();
    expect(owner.region.value).toStrictEqual({ kind: 'loading' });
    expect(districtCodeAt).toHaveBeenCalledWith(XUANWU);
    pending[0]?.resolve('320102');
    await settle();
    expect(owner.region.value).toStrictEqual({ kind: 'ready', region: findRegion('320102') });

    owner.place(SHANGHAI, 'drag');
    await settle();
    pending[1]?.resolve(null);
    await settle();
    expect(owner.region.value).toStrictEqual({ kind: 'ready', region: null });

    owner.remove();
    await settle();
    expect(owner.region.value).toStrictEqual({ kind: 'none' });
  });

  it('只打开位置信息时不重新判断；只采用最后一次判断的结果；失败时记下原因', async () => {
    const { owner, pending, districtCodeAt } = setup();
    const error = new Error('断网');

    owner.place(XUANWU, 'drag');
    await settle();
    owner.setInfoOpen(true);
    owner.place(SHANGHAI, 'drag');
    await settle();
    expect(districtCodeAt).toHaveBeenCalledTimes(2);

    pending[1]?.reject(error);
    await settle();
    pending[0]?.resolve('320102');
    await settle();

    expect(owner.region.value).toStrictEqual({ kind: 'failed', error });
  });

  it('前一次判断晚到时，不论成功还是失败都不覆盖后一次的结果', async () => {
    const { owner, pending } = setup();

    owner.place(SHANGHAI, 'drag');
    await settle();
    owner.place(XUANWU, 'drag');
    await settle();
    pending[1]?.resolve('320102');
    await settle();
    pending[0]?.reject(new Error('断网'));
    await settle();

    expect(owner.region.value).toStrictEqual({ kind: 'ready', region: findRegion('320102') });
  });

  it('作用域销毁后，晚到的判断结果不写入', async () => {
    const { owner, scope, pending } = setup();
    owner.place(XUANWU, 'input');
    await settle();

    scope.stop();
    pending[0]?.resolve('320102');
    await settle();

    expect(owner.region.value).toStrictEqual({ kind: 'loading' });
  });

  it('没有注入时用共享的县界：两个拥有者只下载一次', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(countyFile)));
    vi.stubGlobal('fetch', fetch);
    const scope = effectScope();
    const owners = scope.run(() => [useLocationPoint(idleMap()), useLocationPoint(idleMap())]);

    owners?.forEach(owner => owner.place(XUANWU, 'input'));
    await settle();
    await settle();

    expect(owners?.map(owner => owner.region.value)).toStrictEqual([
      { kind: 'ready', region: findRegion('320102') },
      { kind: 'ready', region: findRegion('320102') }
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    scope.stop();
  });

  it('不在组件 setup 或 effectScope 中调用时抛错', () => {
    expect(() => useLocationPoint(idleMap())).toThrow('useLocationPoint 只能在组件的 setup 或 effectScope 中调用');
  });
});
