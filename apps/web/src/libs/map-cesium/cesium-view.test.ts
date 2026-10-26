import { type CameraState, type MapInputEvent, MapSession, type StyleGroup, type ToolView } from '@yzt/map-core';
import { createNanoEvents } from 'nanoevents';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CesiumScene } from './cesium-scene';
import { CesiumView } from './cesium-view';
import {
  type SceneEvents,
  type SceneGestures,
  type SceneLike,
  type ScenePose,
  WebGLUnavailableError
} from './scene-like';
import type { ImageryPlan } from './scene-style';

const START: CameraState = { center: [119.5, 33], zoom: 6.8, bearing: 0, pitch: 0 };

/** 假场景：相机就是一个值，定位立即生效或停在动画里，事件由用例触发 */
class FakeScene implements SceneLike {
  camera: CameraState = { center: [0, 0], zoom: 1, bearing: 0, pitch: 0 };
  target: CameraState | null = null;
  flyDuration: number | undefined;
  imagery: readonly ImageryPlan[] = [];
  baseColor: string | null = null;
  gestures: SceneGestures = { drag: true };
  cursor: string | undefined;
  rendering = true;
  focused = 0;
  resized = 0;
  restored: ScenePose | null = null;
  disposed = false;
  readonly calls: string[] = [];
  readonly pose: ScenePose = { position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0] };
  readonly #events = createNanoEvents<SceneEvents>();

  get flying(): boolean {
    return this.target !== null;
  }

  readCamera(): CameraState {
    return this.camera;
  }

  jumpTo(camera: CameraState): void {
    this.calls.push('jumpTo');
    this.camera = camera;
  }

  flyTo(camera: CameraState, duration: number | undefined): void {
    this.calls.push('flyTo');
    this.target = camera;
    this.flyDuration = duration;
  }

  completeFlight(): void {
    if (this.target) {
      this.camera = this.target;
      this.target = null;
    }
  }

  cancelFlight(): void {
    this.target = null;
  }

  savePose(): ScenePose {
    return this.pose;
  }

  restorePose(pose: ScenePose): void {
    this.calls.push('restorePose');
    this.restored = pose;
  }

  pick() {
    return { kind: 'hit', surface: 'ellipsoid', lngLat: [119, 32], height: 0 } as const;
  }

  project() {
    return { x: 10, y: 20 };
  }

  size() {
    return { width: 1000, height: 800 };
  }

  setImagery(imagery: readonly ImageryPlan[]): void {
    this.imagery = imagery;
  }

  setBaseColor(color: string | null): void {
    this.baseColor = color;
  }

  setGestures(gestures: SceneGestures): void {
    this.gestures = gestures;
  }

  setCursor(cursor: string | undefined): void {
    this.cursor = cursor;
  }

  focus(): void {
    this.focused++;
  }

  setRendering(active: boolean): void {
    this.rendering = active;
  }

  resize(): void {
    this.resized++;
  }

  on<E extends keyof SceneEvents>(event: E, callback: SceneEvents[E]) {
    return this.#events.on(event, callback);
  }

  emit<E extends keyof SceneEvents>(event: E, ...args: Parameters<SceneEvents[E]>): void {
    this.#events.emit(event, ...args);
  }

  /** 用户拖动：按下鼠标，相机移到 camera，停下 */
  drag(camera: CameraState): void {
    this.emit('interact');
    this.camera = camera;
    this.emit('camerachange');
    this.emit('cameraidle');
  }

  [Symbol.dispose](): void {
    this.disposed = true;
  }
}

const sessions: MapSession<'basemap' | 'boundaries'>[] = [];
const views: CesiumView<'basemap' | 'boundaries'>[] = [];
afterEach(() => {
  views.splice(0).forEach(view => view[Symbol.dispose]());
  sessions.splice(0).forEach(session => session[Symbol.dispose]());
});

function setup({ active = true, scene = new FakeScene() } = {}) {
  const session = new MapSession({ groups: ['basemap', 'boundaries'], camera: START });
  sessions.push(session);
  session.style.setGroup('basemap', {
    sources: { 'basemap-imagery': { type: 'raster', tiles: ['https://tiles.cn/{z}/{x}/{y}'], tileSize: 256 } },
    layers: [
      { id: 'basemap-background', type: 'background', paint: { 'background-color': '#f3f5f8' } },
      { id: 'basemap-imagery', type: 'raster', source: 'basemap-imagery' }
    ]
  });
  const onError = vi.fn<(error: unknown) => void>();
  const onUnsupported = vi.fn<(layer: { layerId: string; reason: string }) => void>();
  const view = new CesiumView({
    session,
    container: document.createElement('div'),
    active,
    onError,
    onUnsupported,
    createScene: () => scene
  });
  views.push(view);
  const changes: { view: string; cause: string }[] = [];
  session.camera.on('change', ({ view: kind, cause }) => changes.push({ view: kind, cause }));
  return { session, scene, view, onError, onUnsupported, changes };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('CesiumView', () => {
  it('真实的场景满足窄接口', () => {
    expectTypeOf<CesiumScene>().toExtend<SceneLike>();
  });

  it('创建后就绪：样式镜像到场景，相机按会话同步，whenReady 结束', async () => {
    const { scene, view } = setup();

    await expect(view.whenReady()).resolves.toBeUndefined();
    expect(view.state).toBe('ready');
    expect(scene.camera).toStrictEqual(START);
    expect(scene.calls).toStrictEqual(['jumpTo']);
    expect(scene.imagery.map(({ id }) => id)).toStrictEqual(['basemap-imagery']);
    expect(scene.baseColor).toBe('#f3f5f8');
    expect(scene.rendering).toBe(true);
  });

  it('active 为 false 时创建后暂停，不渲染，whenReady 照样结束', async () => {
    const { scene, view } = setup({ active: false });

    await expect(view.whenReady()).resolves.toBeUndefined();
    expect(view.state).toBe('paused');
    expect(scene.rendering).toBe(false);
    expect(scene.calls).toStrictEqual([]);
  });

  it('不支持 WebGL 时进入引擎失败，whenReady 以原因结束', async () => {
    const session = new MapSession({ groups: ['basemap'], camera: START });
    sessions.push(session);
    const error = new WebGLUnavailableError();
    const onError = vi.fn<(error: unknown) => void>();
    const view = new CesiumView({
      session,
      container: document.createElement('div'),
      onError,
      createScene: () => {
        throw error;
      }
    });

    await expect(view.whenReady()).rejects.toBe(error);
    expect(view.state).toBe('failed');
    expect(view.failure).toStrictEqual({ kind: 'engine', cause: 'webgl-unavailable', error });
    expect(onError).toHaveBeenCalledWith(error);
    view[Symbol.dispose]();
  });

  it('渲染出错时进入引擎失败，原因是 unknown', async () => {
    const { scene, view, onError } = setup();
    await view.whenReady();
    const error = new Error('渲染失败');

    scene.emit('failure', error);

    expect(view.failure).toStrictEqual({ kind: 'engine', cause: 'unknown', error });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('用户拖动按 user 写回会话，第一次变化时开始一次新的相机操作', async () => {
    const { session, scene, view, changes } = setup();
    await view.whenReady();
    const previous = session.camera.operation;
    const moved: CameraState = { center: [120, 32], zoom: 9, bearing: 15, pitch: 30 };

    scene.emit('interact');
    scene.camera = { ...moved, zoom: 8 };
    scene.emit('camerachange');
    const current = session.camera.operation;
    scene.camera = moved;
    scene.emit('camerachange');
    scene.emit('cameraidle');

    expect(session.camera.current).toStrictEqual(moved);
    expect(changes.map(({ view: kind, cause }) => `${kind} ${cause}`)).toStrictEqual(['3d user', '3d user']);
    expect(previous.aborted).toBe(true);
    // 同一次拖动只开始一次操作
    expect(session.camera.operation).toBe(current);
    expect(current.aborted).toBe(false);
  });

  it('程序定位按 program 写回；留白只决定这一次把目标放在哪里', async () => {
    const { session, scene, view, changes } = setup();
    await view.whenReady();
    const operation = session.camera.operation;

    view.flyTo({ center: [120, 32], zoom: 10 }, { duration: 500, padding: { top: 0, right: 0, bottom: 0, left: 200 } });
    const target = scene.target;
    expect(target?.zoom).toBe(10);
    expect(target?.center[0]).toBeLessThan(120);
    expect(scene.flyDuration).toBe(500);
    scene.camera = { ...START, zoom: 8 };
    scene.emit('camerachange');
    scene.completeFlight();
    scene.emit('cameraidle');

    expect(changes.map(({ cause }) => cause)).toStrictEqual(['program', 'program']);
    // 程序定位的移动不开始新的操作
    expect(operation.aborted).toBe(false);
    expect(session.camera.current.zoom).toBe(10);
  });

  it('定位动画中用户按下鼠标：动画停下，接下来的移动是用户操作', async () => {
    const { scene, view, changes } = setup();
    await view.whenReady();
    view.flyTo({ zoom: 12 });

    scene.drag({ ...START, zoom: 7 });

    expect(scene.flying).toBe(false);
    expect(changes.at(-1)?.cause).toBe('user');
  });

  it('fitBounds 按二维的取景算出相机，俯角不传时保持当前的', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();
    scene.drag({ ...START, pitch: 40 });

    view.fitBounds([118, 31, 120, 33], { maxZoom: 9 });

    expect(scene.target?.zoom).toBeLessThanOrEqual(9);
    expect(scene.target?.pitch).toBe(40);
    expect(scene.target?.bearing).toBe(0);
    expect(session.camera.current.pitch).toBe(40);
  });

  it('暂停：进行中的定位直接到终点按 program 写回，停止渲染，不再转交输入', async () => {
    const { session, scene, view, changes } = setup();
    await view.whenReady();
    const inputs: MapInputEvent[] = [];
    session.tool.register('probe', {
      persistent: true,
      handleInput: (event: MapInputEvent) => {
        inputs.push(event);
      }
    });
    session.tool.activate('probe');
    view.flyTo({ zoom: 11 }, { duration: 1000 });

    view.pause();

    expect(view.state).toBe('paused');
    expect(scene.rendering).toBe(false);
    expect(session.camera.current.zoom).toBe(11);
    expect(changes.at(-1)?.cause).toBe('program');
    scene.emit('key', 'Escape');
    expect(inputs).toStrictEqual([]);
  });

  it('切走期间二维只有同步：回来时还原离开时的精确相机', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();
    view.pause();
    session.camera.set({ ...START, pitch: 55 }, { view: '2d', cause: 'sync' });

    view.resume();

    expect(scene.restored).toBe(scene.pose);
    expect(scene.resized).toBe(1);
    expect(view.state).toBe('ready');
  });

  it('切走期间二维被用户移动过：回来时按会话的相机重新定位', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();
    view.pause();
    const moved: CameraState = { center: [118, 31], zoom: 12, bearing: 0, pitch: 0 };
    session.camera.set(moved, { view: '2d', cause: 'user' });
    session.camera.set({ ...moved, zoom: 12.5 }, { view: '2d', cause: 'sync' });

    view.resume();

    expect(scene.restored).toBeNull();
    expect(scene.camera).toStrictEqual({ ...moved, zoom: 12.5 });
  });

  it('暂停期间的样式变化留到恢复时应用', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();
    view.pause();
    session.style.setGroup('basemap', { sources: {}, layers: [] });
    await flush();
    expect(scene.imagery).toHaveLength(1);

    view.resume();

    expect(scene.imagery).toStrictEqual([]);
    expect(scene.baseColor).toBeNull();
  });

  it('支持清单之外的图层每个只报告一次', async () => {
    const { session, view, onUnsupported } = setup();
    await view.whenReady();
    const boundaries: StyleGroup = {
      sources: { line: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'boundaries-line', type: 'line', source: 'line' }]
    };

    session.style.setGroup('boundaries', boundaries);
    await flush();
    session.style.setGroup('boundaries', { ...boundaries });
    await flush();

    expect(onUnsupported).toHaveBeenCalledExactlyOnceWith({ layerId: 'boundaries-line', reason: '三维暂不支持 line 图层' });
  });

  it('影像的瓦片错误按数据源记第一条，数据源移除时忘掉', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();
    const changed = vi.fn<() => void>();
    view.on('sourceerrorchange', changed);
    const first = new Error('404');

    scene.emit('imageryerror', 'basemap-imagery', first);
    scene.emit('imageryerror', 'basemap-imagery', new Error('500'));
    expect(view.sourceErrors).toStrictEqual(new Map([['basemap-imagery', first]]));
    expect(changed).toHaveBeenCalledOnce();

    session.style.setGroup('basemap', { sources: {}, layers: [] });
    await flush();
    expect(view.sourceErrors.size).toBe(0);
  });

  it('就绪时把画布上的输入交给当前工具，工具拿到的视图种类是 3d', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();
    const received: { event: MapInputEvent; view: ToolView }[] = [];
    session.tool.register('probe', {
      persistent: true,
      handleInput: (event: MapInputEvent, toolView: ToolView) => {
        received.push({ event, view: toolView });
      }
    });
    session.tool.activate('probe');
    const event: MapInputEvent = {
      type: 'click',
      point: { x: 5, y: 6 },
      button: 0,
      clickCount: 1,
      modifiers: { shift: false, ctrl: false, alt: false, meta: false }
    };

    scene.emit('pointer', event);

    expect(received.map(item => item.event)).toStrictEqual([event]);
    expect(received[0]?.view.kind).toBe('3d');
    expect(received[0]?.view.pick({ x: 0, y: 0 })).toStrictEqual(scene.pick());
    expect(received[0]?.view.queryRendered({ x: 0, y: 0 }, { sources: ['a'] })).toStrictEqual([]);
  });

  it('工具关掉拖动平移时场景不能左键拖动；临时任务把焦点移到画布上', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();
    session.tool.register('pick', { persistent: true, cursor: 'crosshair', gestures: { dragPan: false } });
    session.tool.register('measure', { persistent: false });

    session.tool.activate('pick');
    expect(scene.gestures).toStrictEqual({ drag: false });
    expect(scene.cursor).toBe('crosshair');
    expect(scene.focused).toBe(0);

    session.tool.activate('measure');
    expect(scene.gestures).toStrictEqual({ drag: true });
    expect(scene.cursor).toBeUndefined();
    expect(scene.focused).toBe(1);
  });

  it('没有就绪时不能定位、拾取、投影；释放时同时释放场景', async () => {
    const { scene, view } = setup({ active: false });
    await view.whenReady();

    expect(() => view.flyTo({ zoom: 3 })).toThrow('只能在 ready 时');
    expect(() => view.pick({ x: 0, y: 0 })).toThrow('只能在 ready 时');
    view[Symbol.dispose]();
    expect(view.state).toBe('disposed');
    expect(scene.disposed).toBe(true);
  });
});
