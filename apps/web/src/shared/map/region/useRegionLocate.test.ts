// @vitest-environment node
import { CameraModel, type ViewBounds } from '@yzt/map-core';
import type { MapContext, MapViewport } from '@yzt/map-vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import countyFile from '../boundary/data/jiangsu-county.json?raw';
import { findRegion, type Region } from './region-catalog';
import type { RegionBoundary, RegionBoundaryLoader } from './region-geometry';
import { nextRegionSelection, type RegionLocateOptions, useRegionLocate } from './useRegionLocate';

const FIT_OPTIONS = { duration: 1100, maxZoom: 14.5, pitch: 0 };

// 只经过微任务的等待，让加载和定位走完
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function region(code: string): Region {
  const found = findRegion(code);
  if (!found) {
    throw new Error(`目录里没有 ${code}`);
  }
  return found;
}

// 每个区划一个不同的范围，便于区分定位到了哪里
function boundaryOf(code: string): RegionBoundary {
  const offset = Number(code.slice(-3)) / 1000;
  const bounds: ViewBounds = [118 + offset, 31, 119 + offset, 32];
  return { code, geometry: { type: 'Polygon', coordinates: [[[118, 31]]] }, bounds };
}

/** 加载由测试逐个放行：resolve / reject 时才结束 */
function manualLoader() {
  const pending = new Map<string, { resolve: (boundary: RegionBoundary) => void; reject: (error: unknown) => void }>();
  const load = vi.fn<RegionBoundaryLoader['load']>(
    ({ code }) => new Promise((resolve, reject) => pending.set(code, { resolve, reject }))
  );
  const take = (code: string) => {
    const entry = pending.get(code);
    if (!entry) {
      throw new Error(`没有在加载 ${code}`);
    }
    pending.delete(code);
    return entry;
  };
  return {
    loader: { load },
    load,
    resolve: (code: string) => take(code).resolve(boundaryOf(code)),
    reject: (code: string, error: unknown) => take(code).reject(error)
  };
}

// 按 whenReady 的约定等待：ready 结束时就绪，signal 中止时以 AbortError 结束
function readyAfter(ready: Promise<void>): MapContext['whenReady'] {
  return signal =>
    new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException('等待被中止', 'AbortError'));
      if (signal?.aborted) {
        abort();
      }
      signal?.addEventListener('abort', abort, { once: true });
      void ready.then(resolve);
    });
}

function fakeMap(whenReady: MapContext['whenReady'] = readyAfter(Promise.resolve())) {
  const fitBounds = vi.fn<MapViewport['fitBounds']>();
  const viewport: MapViewport = {
    kind: '2d',
    flyTo: vi.fn<MapViewport['flyTo']>(),
    fitBounds,
    pick: vi.fn<MapViewport['pick']>(),
    project: vi.fn<MapViewport['project']>()
  };
  const view = shallowRef<MapViewport | null>(viewport);
  // 真实的相机模型：测试再开始一次操作，表示这期间有了新的相机操作（拖动、默认视角、坐标定位）
  const camera = new CameraModel({ center: [119, 32], zoom: 7, bearing: 0, pitch: 0 });
  const map = {
    view,
    whenReady: vi.fn<MapContext['whenReady']>(whenReady),
    beginCameraOperation: () => camera.beginOperation()
  };
  return { map, fitBounds, camera };
}

function setup(whenReady?: MapContext['whenReady']) {
  const manual = manualLoader();
  const { map, fitBounds, camera } = fakeMap(whenReady);
  const goToDefaultView = vi.fn<RegionLocateOptions['goToDefaultView']>();
  const scope = effectScope();
  const locate = scope.run(() => useRegionLocate(map, { goToDefaultView, loader: manual.loader }));
  if (!locate) {
    throw new Error('没有创建区划定位');
  }
  return { locate, scope, map, camera, fitBounds, goToDefaultView, ...manual };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRegionLocate', () => {
  it('开始时是全省：没有选择、没有高亮，也不加载', () => {
    const { locate, load } = setup();

    expect(locate.state.value).toStrictEqual({ selected: null, boundary: { kind: 'none' } });
    expect(locate.deriveGroup()).toStrictEqual({ sources: {}, layers: [] });
    expect(load).not.toHaveBeenCalled();
  });

  it('选择区划：加载中没有高亮；边界到位后高亮，等视图就绪后定位一次', async () => {
    const { locate, map, fitBounds, resolve } = setup();

    locate.select('320213');
    expect(locate.state.value).toStrictEqual({ selected: region('320213'), boundary: { kind: 'loading' } });
    expect(locate.deriveGroup().layers).toStrictEqual([]);

    resolve('320213');
    await settle();

    expect(locate.state.value).toStrictEqual({
      selected: region('320213'),
      boundary: { kind: 'ready', boundary: boundaryOf('320213') }
    });
    expect(Object.keys(locate.deriveGroup().sources)).toStrictEqual(['region']);
    expect(map.whenReady).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(fitBounds.mock.calls).toStrictEqual([[boundaryOf('320213').bounds, FIT_OPTIONS]]);
  });

  it('选择本身是一次相机操作，作废之前没完成的定位；相机移动（如上一次定位的动画）不算新的操作', async () => {
    const { locate, camera, fitBounds, resolve } = setup();
    const earlier = camera.beginOperation();

    locate.select('320100');
    expect(earlier.aborted).toBe(true);
    camera.set({ center: [118.9, 32.1], zoom: 9, bearing: 0, pitch: 0 }, { view: '2d', cause: 'program' });
    resolve('320100');
    await settle();

    expect(fitBounds).toHaveBeenCalledOnce();
  });

  it('加载期间有了新的相机操作（拖动、缩放、默认视角、坐标定位）：边界到位后只高亮，不覆盖当前视角', async () => {
    const { locate, camera, fitBounds, resolve } = setup();

    locate.select('320100');
    camera.beginOperation();
    resolve('320100');
    await settle();

    expect(locate.state.value.boundary.kind).toBe('ready');
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('等视图就绪期间有了新的相机操作：同样不定位', async () => {
    let ready: (() => void) | undefined;
    const { locate, camera, fitBounds, resolve } = setup(readyAfter(new Promise(done => (ready = done))));

    locate.select('320100');
    resolve('320100');
    await settle();
    camera.beginOperation();
    ready?.();
    await settle();

    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('重试时从重试的那一刻算起：之前的相机操作不影响定位', async () => {
    const { locate, camera, fitBounds, resolve, reject } = setup();

    locate.select('320100');
    reject('320100', new Error('断网'));
    await settle();
    camera.beginOperation();
    locate.retry();
    resolve('320100');
    await settle();

    expect(fitBounds).toHaveBeenCalledOnce();
  });

  it('加载中换选：前一次晚到的结果不写入、不定位', async () => {
    const { locate, fitBounds, resolve } = setup();

    locate.select('320100');
    locate.select('320213');
    resolve('320213');
    await settle();
    resolve('320100');
    await settle();

    expect(locate.state.value.selected).toBe(region('320213'));
    expect(fitBounds.mock.calls).toStrictEqual([[boundaryOf('320213').bounds, FIT_OPTIONS]]);
  });

  it('回到全省：清掉选择和高亮，回到默认视角；本来就是全省时不回', async () => {
    const { locate, goToDefaultView, resolve } = setup();
    locate.select(null);
    expect(goToDefaultView).not.toHaveBeenCalled();

    locate.select('320100');
    resolve('320100');
    await settle();
    locate.select(null);

    expect(locate.state.value).toStrictEqual({ selected: null, boundary: { kind: 'none' } });
    expect(locate.deriveGroup()).toStrictEqual({ sources: {}, layers: [] });
    expect(goToDefaultView).toHaveBeenCalledOnce();
  });

  it('加载中回到全省：晚到的结果不写入、不定位', async () => {
    const { locate, fitBounds, goToDefaultView, resolve } = setup();

    locate.select('320100');
    locate.select(null);
    resolve('320100');
    await settle();

    expect(locate.state.value.selected).toBeNull();
    expect(fitBounds).not.toHaveBeenCalled();
    expect(goToDefaultView).toHaveBeenCalledOnce();
  });

  it('换选或回到全省后，前一次晚到的失败也不写入', async () => {
    const switched = setup();
    const cleared = setup();

    switched.locate.select('320100');
    switched.locate.select('320213');
    cleared.locate.select('320100');
    cleared.locate.select(null);
    switched.reject('320100', new Error('断网'));
    cleared.reject('320100', new Error('断网'));
    await settle();

    expect(switched.locate.state.value).toStrictEqual({ selected: region('320213'), boundary: { kind: 'loading' } });
    expect(cleared.locate.state.value).toStrictEqual({ selected: null, boundary: { kind: 'none' } });
  });

  it('再选当前的区划什么也不做；不认识的代码抛错，状态不变', () => {
    const { locate, load } = setup();
    locate.select('320100');
    const before = locate.state.value;

    locate.select('320100');
    expect(() => locate.select('320000')).toThrow('区划目录里没有 320000');

    expect(load).toHaveBeenCalledOnce();
    expect(locate.state.value).toBe(before);
  });

  it('加载失败时记下原因、不高亮、不定位；重试后重新加载；没有失败时重试什么也不做', async () => {
    const { locate, load, fitBounds, resolve, reject } = setup();
    const error = new Error('断网');
    locate.retry();
    expect(load).not.toHaveBeenCalled();

    locate.select('320100');
    reject('320100', error);
    await settle();
    expect(locate.state.value).toStrictEqual({ selected: region('320100'), boundary: { kind: 'failed', error } });
    expect(locate.deriveGroup().layers).toStrictEqual([]);
    expect(fitBounds).not.toHaveBeenCalled();

    locate.retry();
    expect(locate.state.value.boundary).toStrictEqual({ kind: 'loading' });
    resolve('320100');
    await settle();
    locate.retry();

    expect(locate.state.value.boundary.kind).toBe('ready');
    expect(load).toHaveBeenCalledTimes(2);
    expect(fitBounds).toHaveBeenCalledOnce();
  });

  it('视图没就绪时等到就绪再定位；等待失败（视图被替换或失败）时不定位，高亮照常', async () => {
    let ready: (() => void) | undefined;
    const waiting = setup(() => new Promise(resolve => (ready = resolve)));
    const failing = setup(() => Promise.reject(new DOMException('视图已卸下', 'AbortError')));

    waiting.locate.select('320100');
    failing.locate.select('320100');
    waiting.resolve('320100');
    failing.resolve('320100');
    await settle();
    expect(waiting.fitBounds).not.toHaveBeenCalled();

    ready?.();
    await settle();

    expect(waiting.fitBounds).toHaveBeenCalledOnce();
    expect(failing.fitBounds).not.toHaveBeenCalled();
    expect(failing.locate.state.value.boundary.kind).toBe('ready');
  });

  it('作用域销毁时：进行中的加载结果不写入，等待就绪的定位被中止', async () => {
    const loading = setup();
    let signal: AbortSignal | undefined;
    const waiting = setup(received => {
      signal = received;
      return new Promise(() => {});
    });
    loading.locate.select('320100');
    waiting.locate.select('320100');
    waiting.resolve('320100');
    await settle();

    loading.scope.stop();
    waiting.scope.stop();
    loading.resolve('320100');
    await settle();

    expect(loading.locate.state.value.boundary).toStrictEqual({ kind: 'loading' });
    expect(signal?.aborted).toBe(true);
  });

  it('没有注入加载器时用共享的：两个拥有者加载同一个文件只下载一次', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json(JSON.parse(countyFile))));
    vi.stubGlobal('fetch', fetch);
    const scope = effectScope();
    const owners = scope.run(() =>
      [fakeMap().map, fakeMap().map].map(map => useRegionLocate(map, { goToDefaultView: () => {} }))
    );

    owners?.[0]?.select('320102');
    owners?.[1]?.select('320213');
    await settle();
    await settle();

    expect(owners?.map(owner => owner.state.value.boundary.kind)).toStrictEqual(['ready', 'ready']);
    expect(fetch).toHaveBeenCalledOnce();
    scope.stop();
  });

  it('面板上的点击：点别的区划选它；再点已选中的市回到全省，再点已选中的区县回到所在的市', () => {
    expect(nextRegionSelection(null, region('320100'))).toBe('320100');
    expect(nextRegionSelection(region('320100'), region('320102'))).toBe('320102');
    expect(nextRegionSelection(region('320100'), region('320100'))).toBeNull();
    expect(nextRegionSelection(region('320102'), region('320102'))).toBe('320100');
    expect(nextRegionSelection(region('320102'), region('320104'))).toBe('320104');
    expect(nextRegionSelection(region('320102'), region('320200'))).toBe('320200');
  });

  it('选中区县时它所在的市也算选中，再点这个市回到全省（同旧项目）', () => {
    expect(nextRegionSelection(region('320102'), region('320100'))).toBeNull();
  });

  it('不在组件 setup 或 effectScope 中调用时抛错', () => {
    const { map } = fakeMap();

    expect(() => useRegionLocate(map, { goToDefaultView: () => {} })).toThrow(
      'useRegionLocate 只能在组件的 setup 或 effectScope 中调用'
    );
  });
});
