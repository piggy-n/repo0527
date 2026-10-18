import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl } from 'cesium';
import { MapSession, type CameraChange } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { CesiumView } from './cesium-view';

// 官方导出函数的 setBaseUrl 在当前发布类型中遗漏；测试只使用本地静态资源
(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

function setup(active = true) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = 'width:800px;height:600px;';
  const session = new MapSession({ groups: [], camera: { center: [119, 32], zoom: 8, bearing: 0, pitch: 0 } });
  const errors: unknown[] = [];
  const changes: CameraChange[] = [];
  const unsubscribe = session.camera.on('change', change => changes.push(change));
  const view = new CesiumView({ session, container, assetBaseUrl: '/cesium/', active, onError: e => errors.push(e) });
  return {
    container, session, view, errors, changes,
    [Symbol.dispose]() {
      view[Symbol.dispose](); unsubscribe(); session[Symbol.dispose](); container.remove();
    }
  };
}

// 将可能悬挂的等待转为有时限的结果，失败由断言给出，结束后清除计时器
async function outcome(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => 'ready', error => String(error)),
      new Promise<string>(resolve => { timer = setTimeout(() => resolve('timeout'), 8000); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// 在操作前登记渲染事件；等待结束后释放监听，不把 whenReady 当作画面已稳定
function settled(view: CesiumView) {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  const unsubscribe = view.on('settle', resolve);
  return outcome(promise).finally(unsubscribe);
}

describe('Cesium 真实视图', () => {
  it('本地底图加载、拾取投影往返与背面排除，程序定位按毫秒完成', async () => {
    using fixture = setup();
    const { view, errors, changes } = fixture;
    const initialFrame = settled(view);
    expect(await outcome(view.whenReady())).toBe('ready');
    expect(await initialFrame).toBe('ready');
    const center = view.pick({ x: 400, y: 300 });
    expect(center.kind).toBe('hit');
    if (center.kind !== 'hit') {
      throw new Error('中心没有命中地表');
    }
    expect(center.surface).toBe('ellipsoid');
    expect(center.lngLat[0]).toBeCloseTo(119, 4);
    expect(view.project(center.lngLat)?.x).toBeCloseTo(400, 2);
    expect(view.project([-61, -32])).toBeNull();
    const done = settled(view);
    view.flyTo({ center: [120, 33], zoom: 9, bearing: 35, pitch: 40 }, {
      duration: 100, padding: { left: 30, right: 210, top: 20, bottom: 80 }
    });
    expect(await done).toBe('ready');
    expect(view.project([120, 33])?.x).toBeCloseTo(310, 1);
    expect(view.project([120, 33])?.y).toBeCloseTo(270, 1);
    expect(changes.some(change => change.cause === 'program')).toBe(true);
    expect(changes.filter(change => change.cause === 'user')).toHaveLength(0);
    expect(errors).toEqual([]);
  }, 20000);

  it('候选视图可以完成预备加载，暂停动画到终点且恢复不漂移', async () => {
    using fixture = setup(false);
    const { view, session, changes } = fixture;
    expect(await outcome(view.whenReady())).toBe('ready');
    expect(view.state).toBe('paused');
    expect(changes).toHaveLength(0);
    const resumed = settled(view);
    view.resume();
    expect(await resumed).toBe('ready');
    view.flyTo({ center: [121, 34], zoom: 10 }, { duration: 2000 });
    view.pause();
    expect(session.camera.current.center[0]).toBeCloseTo(121, 5);
    expect(session.camera.current.center[1]).toBeCloseTo(34, 5);
    expect(changes.at(-1)?.cause).toBe('program');
    const camera = session.camera.current;
    const restored = settled(view);
    view.resume();
    expect(await restored).toBe('ready');
    expect(session.camera.current.zoom).toBeCloseTo(camera.zoom, 7);
    expect(session.camera.current.center[0]).toBeCloseTo(camera.center[0], 7);
    expect(fixture.errors).toEqual([]);
  }, 20000);

  it('范围定位遵守留白，卸载清除画布与输入', async () => {
    using fixture = setup();
    const { view, container } = fixture;
    expect(await outcome(view.whenReady())).toBe('ready');
    const done = settled(view);
    view.fitBounds([118, 30, 122, 35], { duration: 0, pitch: 40, padding: 70 });
    expect(await done).toBe('ready');
    for (const point of [[118, 30], [118, 35], [122, 30], [122, 35]] as const) {
      const pixel = view.project(point);
      expect(pixel).not.toBeNull();
      expect(pixel?.x).toBeGreaterThanOrEqual(70);
      expect(pixel?.x).toBeLessThanOrEqual(730);
      expect(pixel?.y).toBeGreaterThanOrEqual(70);
      expect(pixel?.y).toBeLessThanOrEqual(530);
    }
    view[Symbol.dispose]();
    expect(container.querySelector('canvas')).toBeNull();
    expect(view.state).toBe('disposed');
    expect(fixture.errors).toEqual([]);
  }, 20000);
});
