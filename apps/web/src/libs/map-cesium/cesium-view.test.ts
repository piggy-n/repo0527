import {
  type CameraState,
  type ClientPoint,
  type MapInputEvent,
  type MapPointerEvent,
  MapSession,
  type SceneStatus,
  type StyleGroup,
  type TilesetLayer,
  type ToolView,
  type UndergroundView
} from '@yzt/map-core';
import type { Feature, FeatureCollection, GeoJSON } from 'geojson';
import { createNanoEvents } from 'nanoevents';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CesiumScene } from './cesium-scene';
import { CesiumView } from './cesium-view';
import {
  type SceneEvents,
  type SceneGestures,
  type SceneLike,
  type ScenePose,
  type TilesetOptions,
  WebGLUnavailableError
} from './scene-like';
import type { OverlayLayer } from './overlay-plan';
import type { PreparedTileset } from './prepare-tileset';
import type { ImageryPlan } from './scene-style';

const START: CameraState = { center: [119.5, 33], zoom: 6.8, bearing: 0, pitch: 0 };

// 交给场景、还没建好的瓦片集：用例决定什么时候建好或失败
interface PendingAdd {
  readonly tileset: PreparedTileset;
  readonly signal: AbortSignal;
  readonly resolve: (camera: CameraState) => void;
  readonly reject: (error: Error) => void;
}

/** 假场景：相机就是一个值，定位立即生效或停在动画里，事件由用例触发 */
class FakeScene implements SceneLike {
  camera: CameraState = { center: [0, 0], zoom: 1, bearing: 0, pitch: 0 };
  target: CameraState | null = null;
  flyDuration: number | undefined;
  imagery: readonly ImageryPlan[] = [];
  baseColor: string | null = null;
  overlays: readonly OverlayLayer[] = [];
  overlayUpdates = 0;
  readonly pans: (readonly [ClientPoint, ClientPoint])[] = [];
  // 瓦片集：加进来还没建好的、建好的和它们的显示，钻地的要求
  readonly adding = new Map<string, PendingAdd>();
  readonly tilesets = new Map<string, TilesetOptions>();
  readonly removed: string[] = [];
  underground: UndergroundView | null = null;
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

  panBetween(from: ClientPoint, to: ClientPoint): void {
    this.pans.push([from, to]);
  }

  addTileset(id: string, tileset: PreparedTileset, options: TilesetOptions, signal: AbortSignal): Promise<CameraState> {
    return new Promise((resolve, reject) => {
      this.adding.set(id, {
        tileset,
        signal,
        resolve: camera => {
          this.adding.delete(id);
          this.tilesets.set(id, options);
          resolve(camera);
        },
        reject: error => {
          this.adding.delete(id);
          reject(error);
        }
      });
    });
  }

  updateTileset(id: string, options: TilesetOptions): void {
    this.tilesets.set(id, options);
  }

  removeTileset(id: string): void {
    this.tilesets.delete(id);
    this.removed.push(id);
  }

  setUnderground(underground: UndergroundView | null): void {
    this.underground = underground;
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

  eyeHeight(): number {
    return 420000;
  }

  setImagery(imagery: readonly ImageryPlan[]): void {
    this.imagery = imagery;
  }

  setBaseColor(color: string | null): void {
    this.baseColor = color;
  }

  setOverlays(layers: readonly OverlayLayer[]): void {
    this.overlays = layers;
    this.overlayUpdates++;
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
const containers: HTMLElement[] = [];
afterEach(() => {
  views.splice(0).forEach(view => view[Symbol.dispose]());
  sessions.splice(0).forEach(session => session[Symbol.dispose]());
  containers.splice(0).forEach(container => container.remove());
});

type LoadJson = (url: string, signal: AbortSignal) => Promise<unknown>;

// 默认的下载函数直接失败：用例不发网络请求
const noNetwork: LoadJson = url => Promise.reject(new Error(`用例没有准备 ${url}`));

function setup({
  active = true,
  scene = new FakeScene(),
  loadJson = noNetwork
}: { active?: boolean; scene?: FakeScene; loadJson?: LoadJson } = {}) {
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
  // 挂到文档上：临时拖动在文档上监听移动和按键
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const view = new CesiumView({
    session,
    container,
    active,
    onError,
    onUnsupported,
    createScene: () => scene,
    loadJson
  });
  views.push(view);
  const changes: { view: string; cause: string }[] = [];
  session.camera.on('change', ({ view: kind, cause }) => changes.push({ view: kind, cause }));
  return { session, scene, view, container, onError, onUnsupported, changes };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// 按着 Ctrl 的松开、单击：临时拖动时不交给工具
const ctrlInput = (type: 'up' | 'click'): MapPointerEvent => ({
  type,
  point: { x: 30, y: 15 },
  button: 0,
  clickCount: 1,
  modifiers: { shift: false, ctrl: true, alt: false, meta: false }
});

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
      sources: { names: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'boundaries-names', type: 'symbol', source: 'names' }]
    };

    session.style.setGroup('boundaries', boundaries);
    await flush();
    session.style.setGroup('boundaries', { ...boundaries });
    await flush();

    expect(onUnsupported).toHaveBeenCalledExactlyOnceWith({
      layerId: 'boundaries-names',
      reason: '三维暂不支持 symbol 图层'
    });
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

  it('按住修饰键临时拖动：截下这次按下，场景按指针位置平移，工具收不到松开和单击；光标是手型（ADR 0080 第 4 节）', async () => {
    const { session, scene, view, container } = setup();
    await view.whenReady();
    const received: string[] = [];
    session.tool.register('pick', {
      persistent: true,
      cursor: 'crosshair',
      gestures: { dragPan: false },
      panModifier: 'ctrl',
      handleInput: (event: MapInputEvent) => {
        received.push(event.type);
      }
    });
    session.tool.activate('pick');
    // Cesium 的相机控制在画布上收指针事件，工具的输入来自画布的鼠标事件
    const canvas = document.createElement('canvas');
    container.append(canvas);
    const engineDowns: string[] = [];
    canvas.addEventListener('pointerdown', ({ type }) => engineDowns.push(type));
    canvas.addEventListener('mousedown', ({ type }) => engineDowns.push(type));
    const press = { bubbles: true, cancelable: true, button: 0, ctrlKey: true, clientX: 10, clientY: 10 };

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    expect(scene.cursor).toBe('grab');
    canvas.dispatchEvent(new MouseEvent('pointerdown', press));
    canvas.dispatchEvent(new MouseEvent('mousedown', press));
    expect(scene.cursor).toBe('grabbing');
    canvas.dispatchEvent(new MouseEvent('mousemove', { ...press, clientX: 30, clientY: 15, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mouseup', { ...press, clientX: 30, clientY: 15 }));
    scene.emit('pointer', ctrlInput('up'));
    scene.emit('pointer', ctrlInput('click'));

    expect(engineDowns).toStrictEqual([]);
    expect(scene.pans).toStrictEqual([
      [
        { x: 10, y: 10 },
        { x: 30, y: 15 }
      ]
    ]);
    expect(received).toStrictEqual([]);
    expect(scene.cursor).toBe('grab');
  });

  it('没有就绪时不能定位、拾取、投影；释放时同时释放场景', async () => {
    const { scene, view } = setup({ active: false });
    await view.whenReady();

    expect(() => view.flyTo({ zoom: 3 })).toThrow('只能在 ready 时');
    expect(() => view.pick({ x: 0, y: 0 })).toThrow('只能在 ready 时');
    expect(() => view.eyeHeight()).toThrow('只能在 ready 时');
    view.resume();
    // 视点高度来自场景的相机（ADR 0080 第 6 节）
    expect(view.eyeHeight()).toBe(420000);
    view[Symbol.dispose]();
    expect(view.state).toBe('disposed');
    expect(scene.disposed).toBe(true);
  });
});

const LINE: Feature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [118, 32],
      [119, 33]
    ]
  }
};

const collection = (...features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

function cityLine(data: GeoJSON | string, paint: Record<string, unknown> = {}): StyleGroup {
  return {
    sources: { 'boundaries-city': { type: 'geojson', data } },
    layers: [{ id: 'boundaries-city', type: 'line', source: 'boundaries-city', paint }]
  };
}

function lineWidth(scene: FakeScene): number | undefined {
  const shape = scene.overlays[0]?.shapes[0];
  return shape?.kind === 'line' ? shape.width : undefined;
}

// 一次下载：用例决定什么时候到、到的是什么
function pendingDownload() {
  const calls: { url: string; signal: AbortSignal }[] = [];
  let finish: ((value: unknown) => void) | undefined;
  const loadJson: LoadJson = (url, signal) => {
    calls.push({ url, signal });
    return new Promise(resolve => {
      finish = resolve;
    });
  };
  return { calls, loadJson, finish: (value: unknown) => finish?.(value) };
}

describe('CesiumView 的覆盖物（ADR 0080 第 1 节）', () => {
  it('GeoJSON 图层推导成形状交给场景；只改了别的分组时覆盖物的图层还是同一个对象', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();

    session.style.setGroup('boundaries', cityLine(collection(LINE)));
    await flush();
    const [layer] = scene.overlays;
    expect(layer?.id).toBe('boundaries-city');
    expect(layer?.shapes).toHaveLength(1);

    // 图层个数不变，覆盖物在样式里的位置也不变
    session.style.setGroup('basemap', {
      sources: {},
      layers: [
        { id: 'basemap-background', type: 'background', paint: { 'background-color': '#ffffff' } },
        { id: 'basemap-other', type: 'background' }
      ]
    });
    await flush();
    expect(scene.baseColor).toBe('#ffffff');
    expect(scene.overlays[0]).toBe(layer);
  });

  it('换了一个整数级别才重新推导：线宽跟着级别变，同一级里的缩放不重新推导', async () => {
    const { session, scene, view } = setup();
    await view.whenReady();
    const width = ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 5];
    session.style.setGroup('boundaries', cityLine(collection(LINE), { 'line-width': width }));
    await flush();
    // 6.8 取整为 7
    expect(lineWidth(scene)).toBe(2);
    const updates = scene.overlayUpdates;

    scene.drag({ ...START, zoom: 7.3 });
    expect(scene.overlayUpdates).toBe(updates);
    scene.drag({ ...START, zoom: 7.6 });
    expect(lineWidth(scene)).toBe(3);
  });

  it('数据源是地址时下载，到了再画；两个数据源引用同一个地址只下载一次，样式再变也不重新下载', async () => {
    const download = pendingDownload();
    const { session, scene, view } = setup({ loadJson: download.loadJson });
    await view.whenReady();
    session.style.setGroup('boundaries', {
      sources: {
        'boundaries-a': { type: 'geojson', data: '/city.json' },
        'boundaries-b': { type: 'geojson', data: '/city.json' }
      },
      layers: [
        { id: 'boundaries-a', type: 'line', source: 'boundaries-a' },
        { id: 'boundaries-b', type: 'line', source: 'boundaries-b' }
      ]
    });
    await flush();
    expect(download.calls.map(({ url }) => url)).toStrictEqual(['/city.json']);
    expect(scene.overlays).toStrictEqual([]);

    download.finish(collection(LINE));
    await flush();
    expect(scene.overlays.map(({ id, shapes }) => [id, shapes.length])).toStrictEqual([
      ['boundaries-a', 1],
      ['boundaries-b', 1]
    ]);

    session.style.setGroup('basemap', { sources: {}, layers: [] });
    await flush();
    expect(download.calls).toHaveLength(1);
  });

  it('下载失败、内容不是 GeoJSON 时按数据源记错误；不再引用后忘掉，再次引用时重新下载', async () => {
    const failure = new Error('404');
    const loadJson = vi
      .fn<LoadJson>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('<!doctype html>');
    const { session, view } = setup({ loadJson });
    await view.whenReady();

    session.style.setGroup('boundaries', cityLine('/city.json'));
    await flush();
    expect(view.sourceErrors).toStrictEqual(new Map([['boundaries-city', failure]]));

    session.style.setGroup('boundaries', { sources: {}, layers: [] });
    await flush();
    expect(view.sourceErrors.size).toBe(0);

    session.style.setGroup('boundaries', cityLine('/city.json'));
    await flush();
    expect(loadJson).toHaveBeenCalledTimes(2);
    const error = view.sourceErrors.get('boundaries-city');
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('message', '/city.json 的内容不是 GeoJSON');
  });

  it('释放时取消下载，晚到的数据不再交给场景', async () => {
    const download = pendingDownload();
    const { session, scene, view } = setup({ loadJson: download.loadJson });
    await view.whenReady();
    session.style.setGroup('boundaries', cityLine('/city.json'));
    await flush();
    const updates = scene.overlayUpdates;

    view[Symbol.dispose]();
    expect(download.calls[0]?.signal.aborted).toBe(true);
    download.finish(collection(LINE));
    await flush();

    expect(scene.overlayUpdates).toBe(updates);
  });

  it('暂停期间数据到了，恢复时再画', async () => {
    const download = pendingDownload();
    const { session, scene, view } = setup({ loadJson: download.loadJson });
    await view.whenReady();
    session.style.setGroup('boundaries', cityLine('/city.json'));
    await flush();

    view.pause();
    download.finish(collection(LINE));
    await flush();
    expect(scene.overlays).toStrictEqual([]);

    view.resume();
    expect(scene.overlays.map(({ id }) => id)).toStrictEqual(['boundaries-city']);
  });
});

// 瓦片集的索引：只有一个瓦片
const TILESET_INDEX = {
  root: { boundingVolume: { sphere: [0, 0, 0, 10] }, geometricError: 0, content: { uri: 'a.b3dm' } }
};
const CAMERA_AT_MODEL: CameraState = { center: [120.66, 31.31], zoom: 16, bearing: 0, pitch: 55 };

const tilesetUrl = (id: string) => `https://maps.test/3dt/${id}/tileset.json`;

// 地址以 tileset.json 结尾的给出索引，其余的 404
const indexLoader: LoadJson = url =>
  url.endsWith('/tileset.json') && !url.includes('broken')
    ? Promise.resolve(structuredClone(TILESET_INDEX))
    : Promise.reject(new Error(`404 ${url}`));

function tilesetLayer(id: string, extra: Partial<TilesetLayer> = {}): TilesetLayer {
  return { id, url: tilesetUrl(id), show: true, lighting: 'sun', attempt: 0, ...extra };
}

// 白膜的两种效果，显示其中一种
const whiteEffects = (shown: string) =>
  ['plain', 'window'].map(id => tilesetLayer(id, { group: 'white', show: id === shown }));

// 会话的通知、索引的下载、交给场景都要几轮
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    // oxlint-disable-next-line no-await-in-loop -- 每一轮要等上一轮的宏任务结束，按轮数推进事件循环
    await flush();
  }
}

function pending(scene: FakeScene, id: string): PendingAdd {
  const add = scene.adding.get(id);
  if (!add) {
    throw new Error(`瓦片集 ${id} 没有交给场景`);
  }
  return add;
}

describe('CesiumView 的三维内容（ADR 0081）', () => {
  it('按 ID 加载瓦片集：整理好的索引交给场景，建好后报告就绪和定位用的相机', async () => {
    const { session, scene, view } = setup({ loadJson: indexLoader });
    await view.whenReady();
    const reports: SceneStatus[] = [];
    view.onSceneStatusChange(status => reports.push(status));

    session.scene.set({ tilesets: [tilesetLayer('station', { lighting: 'headlight' })], underground: null });
    await settle();
    expect(view.sceneStatus.get('station')).toStrictEqual({ state: 'loading' });
    expect(pending(scene, 'station').tileset.root.content?.uri).toBe('https://maps.test/3dt/station/a.b3dm');

    pending(scene, 'station').resolve(CAMERA_AT_MODEL);
    await flush();

    expect(view.sceneStatus.get('station')).toStrictEqual({ state: 'ready', camera: CAMERA_AT_MODEL });
    expect(scene.tilesets.get('station')).toStrictEqual({ show: true, lighting: 'headlight' });
    expect(reports.map(status => status.get('station')?.state)).toStrictEqual(['loading', 'ready']);
  });

  it('去掉的从场景移除、进行中的加载中止；只改显示不重新加载；地址或重试次数变了重新加载', async () => {
    const { session, scene, view } = setup({ loadJson: indexLoader });
    await view.whenReady();
    session.scene.set({ tilesets: [tilesetLayer('a'), tilesetLayer('b')], underground: null });
    await settle();
    pending(scene, 'a').resolve(CAMERA_AT_MODEL);
    const loadingB = pending(scene, 'b').signal;

    session.scene.set({ tilesets: [tilesetLayer('a', { show: false })], underground: null });
    await settle();
    expect(loadingB.aborted).toBe(true);
    expect(scene.tilesets.get('a')).toStrictEqual({ show: false, lighting: 'sun' });
    expect([...view.sceneStatus.keys()]).toStrictEqual(['a']);
    expect(scene.removed).toStrictEqual([]);

    session.scene.set({ tilesets: [tilesetLayer('a', { show: false, attempt: 1 })], underground: null });
    await settle();
    expect(scene.removed).toStrictEqual(['a']);
    expect(view.sceneStatus.get('a')).toStrictEqual({ state: 'loading' });
    expect(scene.adding.has('a')).toBe(true);
  });

  it('索引下载失败、建好后瓦片失败时报告失败，每个瓦片集记第一条', async () => {
    const { session, scene, view } = setup({ loadJson: indexLoader });
    await view.whenReady();
    session.scene.set({ tilesets: [tilesetLayer('broken'), tilesetLayer('ok')], underground: null });
    await settle();
    pending(scene, 'ok').resolve(CAMERA_AT_MODEL);
    await flush();
    const first = new Error('瓦片 404');

    scene.emit('tilesetfailed', 'ok', first);
    scene.emit('tilesetfailed', 'ok', new Error('又一个'));

    expect(view.sceneStatus.get('broken')).toMatchObject({ state: 'failed' });
    expect(view.sceneStatus.get('ok')).toStrictEqual({ state: 'failed', error: first });
  });

  it('暂停期间三维内容的变化留到恢复时应用', async () => {
    const { session, scene, view } = setup({ loadJson: indexLoader });
    await view.whenReady();
    view.pause();

    session.scene.set({ tilesets: [tilesetLayer('a')], underground: null });
    await settle();
    expect(scene.adding.size).toBe(0);

    view.resume();
    await settle();
    expect(scene.adding.has('a')).toBe(true);
  });

  it('同组的换显示：新的首批瓦片到位前留着旧的，到了再撤下（ADR 0081 第 5 节）', async () => {
    const { session, scene, view } = setup({ loadJson: indexLoader });
    await view.whenReady();
    session.scene.set({ tilesets: whiteEffects('plain'), underground: null });
    await settle();
    pending(scene, 'plain').resolve(CAMERA_AT_MODEL);
    pending(scene, 'window').resolve(CAMERA_AT_MODEL);
    await flush();
    scene.emit('tilesetinitial', 'plain');

    session.scene.set({ tilesets: whiteEffects('window'), underground: null });
    await settle();
    expect(scene.tilesets.get('plain')?.show).toBe(true);
    expect(scene.tilesets.get('window')?.show).toBe(true);

    scene.emit('tilesetinitial', 'window');
    expect(scene.tilesets.get('plain')?.show).toBe(false);
    expect(scene.tilesets.get('window')?.show).toBe(true);
  });

  it('钻地的要求交给场景', async () => {
    const { session, scene, view } = setup({ loadJson: indexLoader });
    await view.whenReady();
    const underground = { tilesetId: 'station', surfaceOpacity: 0.25 };

    session.scene.set({ tilesets: [tilesetLayer('station')], underground });
    await settle();

    expect(scene.underground).toStrictEqual(underground);
  });

  it('释放时中止进行中的加载，状态清空', async () => {
    const { session, scene, view } = setup({ loadJson: indexLoader });
    await view.whenReady();
    session.scene.set({ tilesets: [tilesetLayer('a')], underground: null });
    await settle();
    const { signal } = pending(scene, 'a');

    view[Symbol.dispose]();

    expect(signal.aborted).toBe(true);
    expect(view.sceneStatus.size).toBe(0);
  });
});
