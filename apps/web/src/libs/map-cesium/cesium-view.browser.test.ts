import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl, ImageryLayer, Scene } from 'cesium';
import { MapSession, type CameraChange, type StyleGroup } from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { CesiumView } from './cesium-view';

// 官方导出函数的 setBaseUrl 在当前发布类型中遗漏；测试只使用本地静态资源
(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

// 全项目并行回归使用软件 WebGL，首次着色器编译需留出余量；仍按渲染事件结束等待
const FRAME_TIMEOUT = 15000;

function setup(active = true, group?: StyleGroup) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = 'width:800px;height:600px;';
  const session = new MapSession({ groups: ['sample'], camera: { center: [119, 32], zoom: 8, bearing: 0, pitch: 0 } });
  if (group) {
    session.style.setGroup('sample', group);
  }
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
      new Promise<string>(resolve => { timer = setTimeout(() => resolve('timeout'), FRAME_TIMEOUT); })
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

// 在渲染回调内读取公开画布，避免 WebGL 默认清空帧缓冲后读到黑色
function centerPixel(view: CesiumView, container: HTMLElement) {
  let resolve!: (pixel: readonly number[]) => void;
  const promise = new Promise<readonly number[]>(yes => { resolve = yes; });
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('缺少测试画布');
  }
  const remove = view.on('settle', () => {
    const sceneCanvas = container.querySelector('canvas');
    if (sceneCanvas) {
      context.drawImage(sceneCanvas, sceneCanvas.width / 2, sceneCanvas.height / 2, 1, 1, 0, 0, 1, 1);
      resolve([...context.getImageData(0, 0, 1, 1).data]);
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<readonly number[]>(yes => { timer = setTimeout(() => yes([]), FRAME_TIMEOUT); })
  ]).finally(() => { clearTimeout(timer); remove(); });
}

// 相同来源配合替换图层，验证真实 Surface 接到会话而非测试单独装配的镜像
const SAMPLE_SOURCE: StyleGroup['sources'] = {
  'sample-area': {
    type: 'geojson', data: {
      type: 'Polygon', coordinates: [[[118.8, 31.8], [119.2, 31.8], [119.2, 32.2], [118.8, 32.2], [118.8, 31.8]]]
    }
  }
};
function sampleStyle(color: string, visible = true): StyleGroup {
  return {
    sources: SAMPLE_SOURCE,
    layers: [
      { id: 'sample-background', type: 'background', paint: { 'background-color': '#0000ff' } },
      {
        id: 'sample-fill', type: 'fill', source: 'sample-area',
        layout: { visibility: visible ? 'visible' : 'none' }, paint: { 'fill-color': color }
      }
    ]
  };
}

describe('Cesium 真实视图', () => {
  it('真实画布镜像会话颜色、显隐，暂停期间的修改在恢复时追上', async () => {
    using fixture = setup(true, sampleStyle('#ff0000'));
    const { view, session, container } = fixture;
    const initial = centerPixel(view, container);
    expect(await outcome(view.whenReady())).toBe('ready');
    expect(await initial).toEqual([255, 0, 0, 255]);
    const changed = centerPixel(view, container);
    session.style.setGroup('sample', sampleStyle('#00ff00'));
    expect(await changed).toEqual([0, 255, 0, 255]);
    view.pause();
    session.style.setGroup('sample', sampleStyle('#ff0000'));
    session.style.setGroup('sample', sampleStyle('#00ff00', false));
    const resumed = centerPixel(view, container);
    view.resume();
    expect(await resumed).toEqual([0, 0, 255, 255]);
    expect(view.sourceErrors.size).toBe(0);
    expect(fixture.errors).toEqual([]);
  }, 30000);

  it('尺寸改变引发级别样式重绘时，首次稳定事件必须对应新画面', async () => {
    using fixture = setup(true, {
      sources: {},
      layers: [{
        id: 'sample-background', type: 'background',
        paint: { 'background-color': ['step', ['zoom'], '#ff0000', 8.1, '#00ff00'] }
      }]
    });
    const { view, container, session } = fixture;
    const initial = centerPixel(view, container);
    expect(await outcome(view.whenReady())).toBe('ready');
    expect(await initial).toEqual([255, 0, 0, 255]);
    const resized = centerPixel(view, container);
    container.style.height = '750px';
    const pixel = await resized;
    expect(session.camera.current.zoom).toBeGreaterThan(8.1);
    expect(pixel).toEqual([0, 255, 0, 255]);
    expect(fixture.errors).toEqual([]);
  }, 20000);

  it('会话场景加载、拾取投影往返与背面排除，程序定位按毫秒完成', async () => {
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

  it('带影像样式的放大缩小动画不会在 SDK 渲染栈内销毁图层', async () => {
    using fixture = setup(true, sampleStyle('#ff0000'));
    const { view, session } = fixture;
    expect(await outcome(view.whenReady())).toBe('ready');
    // oxlint-disable-next-line typescript/unbound-method -- 探针保存原实现，调用时用 call 显式还原 SDK 实例
    const render = Scene.prototype.render;
    // oxlint-disable-next-line typescript/unbound-method -- 探针保存原实现，调用时用 call 显式还原 SDK 实例
    const destroy = ImageryLayer.prototype.destroy;
    let rendering = false;
    // 只记录资源释放的时机，不替换真实 SDK 的绘制和销毁行为
    let destroyedDuringFrame = 0;
    const renderSpy = vi.spyOn(Scene.prototype, 'render').mockImplementation(function(this: Scene, time) {
      rendering = true;
      try { return render.call(this, time); }
      finally { rendering = false; }
    });
    const destroySpy = vi.spyOn(ImageryLayer.prototype, 'destroy').mockImplementation(function(this: ImageryLayer) {
      if (rendering) { destroyedDuringFrame++; }
      return destroy.call(this);
    });
    try {
      for (const zoom of [9, 8, 9.5, 8]) {
        const done = settled(view);
        session.camera.beginOperation();
        view.flyTo({ zoom }, { duration: 300 });
        // oxlint-disable-next-line no-await-in-loop -- 每次真实动画完成后再开始下一次缩放
        expect(await done).toBe('ready');
        expect(fixture.errors).toEqual([]);
        expect(view.state).toBe('ready');
        expect(session.camera.current.zoom).toBeCloseTo(zoom, 5);
      }
      expect(destroyedDuringFrame).toBe(0);
    } finally {
      renderSpy.mockRestore();
      destroySpy.mockRestore();
    }
  }, 70000);

  it('候选视图可以完成预备加载，暂停动画到终点且恢复不漂移', async () => {
    using fixture = setup(false, {
      sources: {},
      layers: [{
        id: 'sample-background', type: 'background',
        paint: { 'background-color': ['step', ['zoom'], '#ff0000', 9.5, '#00ff00'] }
      }]
    });
    const { view, session, changes, container } = fixture;
    expect(await outcome(view.whenReady())).toBe('ready');
    expect(view.state).toBe('paused');
    expect(changes).toHaveLength(0);
    const resumed = centerPixel(view, container);
    view.resume();
    expect(await resumed).toEqual([255, 0, 0, 255]);
    // 等动画真实前进一帧再暂停，覆盖已开始运动而尚未稳定的缓存路径
    let resolveMoving!: () => void;
    const moving = new Promise<void>(resolve => { resolveMoving = resolve; });
    const removeMoving = session.camera.on('change', change => {
      if (change.cause === 'program') { resolveMoving(); }
    });
    try {
      view.flyTo({ center: [121, 34], zoom: 10 }, { duration: 2000 });
      expect(await outcome(moving)).toBe('ready');
      expect(session.camera.current.zoom).toBeLessThan(9.5);
    } finally {
      removeMoving();
    }
    view.pause();
    expect(session.camera.current.center[0]).toBeCloseTo(121, 5);
    expect(session.camera.current.center[1]).toBeCloseTo(34, 5);
    expect(changes.at(-1)?.cause).toBe('program');
    const camera = session.camera.current;
    // 恢复后的首轮渲染前先追赶尺度，不让静止确认窗口把旧尺度影像再画一轮
    const destroy = vi.spyOn(ImageryLayer.prototype, 'destroy');
    // oxlint-disable-next-line typescript/unbound-method -- 观察首帧前的替换次数，调用时保留真实 Scene 实例
    const render = Scene.prototype.render;
    let replacementsBeforeFrame: number | undefined;
    const frame = vi.spyOn(Scene.prototype, 'render').mockImplementation(function(this: Scene, time) {
      replacementsBeforeFrame ??= destroy.mock.calls.length;
      return render.call(this, time);
    });
    try {
      const restored = centerPixel(view, container);
      view.resume();
      expect(await restored).toEqual([0, 255, 0, 255]);
      expect(replacementsBeforeFrame).toBe(1);
    } finally {
      frame.mockRestore();
      destroy.mockRestore();
    }
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
