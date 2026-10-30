import {
  type CameraState,
  type ClientPoint,
  type MapInputEvent,
  type MapPointerEvent,
  MapSession,
  NavGrid,
  navigationFrame,
  type NavPoint,
  type PreparedTileset,
  type RoamStatus,
  type RoutePath,
  type RouteRoam,
  type SceneRoam,
  type SceneStatus,
  type StyleGroup,
  type TilesetLayer,
  type ToolView,
  type UndergroundView,
  type WalkPhase,
  type WalkRoam,
  type WalkView
} from '@yzt/map-core';
import type { Feature, FeatureCollection, GeoJSON } from 'geojson';
import { createNanoEvents } from 'nanoevents';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CesiumScene } from './cesium-scene';
import { CesiumView } from './cesium-view';
import {
  type RoutePlayback,
  type SceneEvents,
  type SceneGestures,
  type SceneLike,
  type ScenePose,
  type SceneWalkStart,
  type TilesetOptions,
  WebGLUnavailableError
} from './scene-like';
import type { OverlayLayer } from './overlay-plan';
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
  // 路线漫游：正在播放的路线、播放状态和调用的先后
  route: RoutePath | null = null;
  playback: RoutePlayback | null = null;
  readonly routeCalls: string[] = [];
  // 步行：开始时交来的、调用的先后；startPhase 是开始时场景报告的阶段（找不到出生点时是 failed）
  walk: SceneWalkStart | null = null;
  readonly walkCalls: string[] = [];
  startPhase: WalkPhase = 'entering';
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

  startRoute(path: RoutePath): void {
    this.route = path;
    this.routeCalls.push('start');
  }

  restartRoute(): void {
    this.routeCalls.push('restart');
  }

  setRoutePlayback(playback: RoutePlayback): void {
    this.playback = playback;
    this.routeCalls.push(`playback ${playback.playing} ${playback.speed}`);
  }

  stopRoute(back: boolean): void {
    this.route = null;
    this.routeCalls.push(`stop ${back}`);
  }

  startWalk(walk: SceneWalkStart): void {
    this.walk = walk;
    this.walkCalls.push('start');
    this.emit('walkphase', this.startPhase);
  }

  setWalkSpeed(speed: number): void {
    this.walkCalls.push(`speed ${speed}`);
  }

  setWalkView(view: WalkView): void {
    this.walkCalls.push(`view ${view}`);
  }

  respawnWalk(): void {
    this.walkCalls.push('respawn');
  }

  unstuckWalk(): void {
    this.walkCalls.push('unstuck');
  }

  teleportWalk({ x, y, floor }: NavPoint): void {
    this.walkCalls.push(`teleport ${x},${y},${floor}`);
  }

  setWalkPaused(paused: boolean): void {
    this.walkCalls.push(`paused ${paused}`);
  }

  stopWalk(back: boolean): void {
    this.walk = null;
    this.walkCalls.push(`stop ${back}`);
    // 和真实的场景一样，步行结束时光标清空
    this.cursor = undefined;
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

  heading(): number {
    return 76;
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

// 往东约 20 米、再往北约 10 米的路线
const ROUTE_PATH: RouteRoam['path'] = [
  [120.666, 31.3175, -5.1],
  [120.6662, 31.3175, -5.1],
  [120.6662, 31.31759, -5.1]
];

const routeRoam = (extra: Partial<RouteRoam> = {}): RouteRoam => ({
  kind: 'route',
  id: 'enter',
  path: ROUTE_PATH,
  playing: false,
  speed: 1,
  run: 0,
  ...extra
});

function roamSetup(options: Parameters<typeof setup>[0] = {}) {
  const context = setup(options);
  const statuses: (RoamStatus | null)[] = [];
  context.view.onRoamStatusChange(status => statuses.push(status));
  const roam = (value: SceneRoam | undefined) =>
    context.session.scene.set({ tilesets: [], underground: null, ...(value ? { roam: value } : {}) });
  return { ...context, statuses, roam };
}

describe('CesiumView 的路线漫游（ADR 0083）', () => {
  it('会话里有了漫游：场景开始这条路线、按意图播放，报告从 0 开始的进度和总长', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();

    roam(routeRoam());
    await settle();

    expect(scene.routeCalls).toStrictEqual(['start', 'playback false 1']);
    const total = scene.route?.total ?? 0;
    expect(total).toBeGreaterThan(25);
    expect(statuses).toStrictEqual([{ kind: 'route', id: 'enter', run: 0, distance: 0, total, finished: false }]);
    expect(view.roamStatus).toStrictEqual(statuses[0]);
  });

  it('走过的距离每变 0.5 米报告一次，到终点时报告走完', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();
    roam(routeRoam({ playing: true }));
    await settle();
    const total = scene.route?.total ?? 0;

    for (const distance of [0.2, 0.4, 0.6, 0.9, 1.2, total]) {
      scene.emit('routeprogress', distance);
    }
    scene.emit('routeend');

    const progress = statuses.map(
      status => status?.kind === 'route' && [Number(status.distance.toFixed(1)), status.finished]
    );
    expect(progress).toStrictEqual([
      [0, false],
      [0.6, false],
      [1.2, false],
      [Number(total.toFixed(1)), false],
      [Number(total.toFixed(1)), true]
    ]);
  });

  it('重新开始回到起点；播放、速度变了才改播放；换一条路线重新开始', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();
    roam(routeRoam({ playing: true }));
    await settle();
    scene.emit('routeprogress', 3);
    scene.routeCalls.length = 0;

    roam(routeRoam({ playing: true, run: 1 }));
    await settle();
    roam(routeRoam({ playing: false, run: 1 }));
    await settle();
    roam(routeRoam({ playing: false, run: 1, speed: 2 }));
    await settle();
    roam(routeRoam({ id: 'platform', playing: false, run: 1, speed: 2 }));
    await settle();

    expect(scene.routeCalls).toStrictEqual([
      'restart',
      'playback false 1',
      'playback false 2',
      'start',
      'playback false 2'
    ]);
    const restarted = statuses
      .slice(-2)
      .map(status => status?.kind === 'route' && [status.id, status.run, status.distance]);
    expect(restarted).toStrictEqual([
      ['enter', 1, 0],
      ['platform', 1, 0]
    ]);
  });

  it('漫游时覆盖物不随级别重新推导：地下的相机算出的级别随视线跳动；结束后按当时的级别推导（ADR 0103）', async () => {
    const { session, scene, view, roam } = roamSetup();
    await view.whenReady();
    const width = ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 5];
    session.style.setGroup('boundaries', cityLine(collection(LINE), { 'line-width': width }));
    await flush();
    roam(routeRoam());
    await settle();
    const updates = scene.overlayUpdates;

    scene.drag({ ...START, zoom: 9.2 });
    scene.drag({ ...START, zoom: 3.4 });
    expect(scene.overlayUpdates).toBe(updates);

    roam(undefined);
    await settle();
    scene.drag({ ...START, zoom: 9.2 });
    expect(lineWidth(scene)).toBe(4);
  });

  it('撤掉漫游：场景结束路线并飞回开始前的位置，进度变成 null', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();
    roam(routeRoam());
    await settle();

    roam(undefined);
    await settle();

    expect(scene.routeCalls.at(-1)).toBe('stop true');
    expect(statuses.at(-1)).toBeNull();
    expect(view.roamStatus).toBeNull();
  });

  it('漫游时相机的变化按 program 写回；按下鼠标、拖动不打断场景的飞行，也不开始新的相机操作', async () => {
    const { session, scene, view, roam } = roamSetup();
    await view.whenReady();
    roam(routeRoam({ playing: true }));
    await settle();
    const operation = session.camera.operation;
    const causes: string[] = [];
    session.camera.on('change', ({ cause }) => causes.push(cause));
    const cancelFlight = vi.spyOn(scene, 'cancelFlight');

    scene.drag({ center: [120.6661, 31.3175], zoom: 20, bearing: 90, pitch: 85 });

    expect(operation.aborted).toBe(false);
    expect(causes).toStrictEqual(['program']);
    expect(cancelFlight).not.toHaveBeenCalled();
  });

  it('页面开始别的定位：路线立即停下、不飞回，之后撤掉漫游时不再结束一次', async () => {
    const { scene, view, roam } = roamSetup();
    await view.whenReady();
    roam(routeRoam({ playing: true }));
    await settle();

    view.flyTo({ center: [119, 32], zoom: 10 });
    roam(undefined);
    await settle();

    expect(scene.routeCalls).toStrictEqual(['start', 'playback true 1', 'stop false']);
    expect(scene.calls.at(-1)).toBe('flyTo');
  });

  it('暂停期间撤掉的漫游在恢复时结束：相机没被别的视图动过才飞回', async () => {
    const { session, scene, view, roam } = roamSetup();
    await view.whenReady();
    roam(routeRoam());
    await settle();

    view.pause();
    roam(undefined);
    await settle();
    expect(scene.routeCalls.at(-1)).toBe('playback false 1');
    view.resume();
    expect(scene.routeCalls.at(-1)).toBe('stop true');

    roam(routeRoam({ id: 'again' }));
    await settle();
    view.pause();
    roam(undefined);
    session.camera.set({ center: [118, 32], zoom: 9, bearing: 0, pitch: 0 }, { view: '2d', cause: 'user' });
    await settle();
    view.resume();
    expect(scene.routeCalls.at(-1)).toBe('stop false');
  });

  it('视图重建时会话里已经在漫游：创建后从起点接上', async () => {
    const scene = new FakeScene();
    const first = roamSetup({ scene });
    await first.view.whenReady();
    first.roam(routeRoam({ playing: true }));
    await settle();
    const rebuilt = new FakeScene();

    const view = new CesiumView({
      session: first.session,
      container: document.createElement('div'),
      createScene: () => rebuilt
    });
    views.push(view);
    await view.whenReady();

    expect(rebuilt.routeCalls).toStrictEqual(['start', 'playback true 1']);
  });
});

// 场景只把导航网格原样交下去：一块空网格就够，局部系的原点在苏州站附近
const navigation = {
  grid: new NavGrid({
    meta: {
      minX: 0,
      minY: 0,
      cellSize: 0.2,
      width: 1,
      height: 1,
      chunksX: 1,
      chunksY: 1,
      maxLevels: 4,
      floorCells: 0,
      droppedLevels: 0
    },
    chunkIndex: Int32Array.of(-1),
    data: new Int16Array(0),
    headroom: new Uint8Array(0)
  }),
  frame: navigationFrame([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -2_700_000, 4_700_000, 3_300_000, 1])
};

const walkRoam = (extra: Partial<WalkRoam> = {}): WalkRoam => ({
  kind: 'walk',
  id: 'walk-1',
  navigation,
  spawn: { lng: 120.6660669, lat: 31.317559, height: -5.1, heading: 76 },
  speed: 1.6,
  respawn: 0,
  unstuck: 0,
  paused: false,
  teleport: null,
  view: 'first',
  avatar: 'https://maps.test/roam/Cesium_Man.glb',
  ...extra
});

describe('CesiumView 的步行（ADR 0086）', () => {
  it('会话里有了步行：场景开始步行，报告进场；飞到出生点后报告行走，提示每来一条计数加 1', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();

    roam(walkRoam());
    await settle();
    expect(scene.walk).toStrictEqual({
      navigation,
      spawn: walkRoam().spawn,
      speed: 1.6,
      view: 'first',
      avatar: 'https://maps.test/roam/Cesium_Man.glb'
    });
    expect(statuses).toStrictEqual([
      { kind: 'walk', id: 'walk-1', phase: 'entering', view: 'first', notice: null, notices: 0, player: null }
    ]);

    scene.emit('walkphase', 'walking');
    scene.emit('walknotice', 'blocked');
    scene.emit('walknotice', 'blocked');

    expect(statuses.slice(1)).toStrictEqual([
      { kind: 'walk', id: 'walk-1', phase: 'walking', view: 'first', notice: null, notices: 0, player: null },
      { kind: 'walk', id: 'walk-1', phase: 'walking', view: 'first', notice: 'blocked', notices: 1, player: null },
      { kind: 'walk', id: 'walk-1', phase: 'walking', view: 'first', notice: 'blocked', notices: 2, player: null }
    ]);
    expect(view.roamStatus).toStrictEqual(statuses.at(-1));
  });

  it('附近找不到出生点：场景开始时就报告 failed，状态停在 failed', async () => {
    const scene = new FakeScene();
    scene.startPhase = 'failed';
    const { view, statuses, roam } = roamSetup({ scene });
    await view.whenReady();

    roam(walkRoam());
    await settle();

    expect(statuses.at(-1)).toMatchObject({ kind: 'walk', phase: 'failed' });
  });

  it('速度变了就改；回到出生点、脱困的计数变了才做一次；撤掉时结束步行、飞回，光标换回工具的', async () => {
    const { session, scene, view, statuses, roam } = roamSetup();
    await view.whenReady();
    session.tool.register('look', { persistent: true, cursor: 'grab' });
    session.tool.activate('look');
    roam(walkRoam());
    await settle();

    roam(walkRoam({ speed: 4 }));
    await settle();
    roam(walkRoam({ speed: 4, respawn: 1 }));
    await settle();
    roam(walkRoam({ speed: 4, respawn: 1, unstuck: 1 }));
    await settle();
    roam(walkRoam({ speed: 4, respawn: 1, unstuck: 1 }));
    await settle();
    scene.cursor = 'not-allowed';
    roam(undefined);
    await settle();

    expect(scene.walkCalls).toStrictEqual(['start', 'speed 4', 'respawn', 'unstuck', 'stop true']);
    expect(scene.cursor).toBe('grab');
    expect(statuses.at(-1)).toBeNull();
  });

  it('人称变了就告诉场景，步行状态跟着换；没变不再调用（ADR 0090）', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();
    roam(walkRoam({ view: 'third' }));
    await settle();
    scene.emit('walkphase', 'walking');

    roam(walkRoam({ view: 'first' }));
    await settle();
    roam(walkRoam({ view: 'first', speed: 4 }));
    await settle();

    expect(scene.walk).toMatchObject({ view: 'third' });
    expect(scene.walkCalls).toStrictEqual(['start', 'view first', 'speed 4']);
    expect(statuses.map(status => status?.kind === 'walk' && [status.phase, status.view])).toStrictEqual([
      ['entering', 'third'],
      ['walking', 'third'],
      ['walking', 'first']
    ]);
  });

  it('换一次漫游：路线换成步行、步行换成路线都直接开始新的，由场景结束上一个', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();
    roam(routeRoam());
    await settle();

    roam(walkRoam());
    await settle();
    roam(walkRoam({ id: 'walk-2' }));
    await settle();
    roam(routeRoam({ id: 'platform' }));
    await settle();

    expect(scene.routeCalls).toStrictEqual(['start', 'playback false 1', 'start', 'playback false 1']);
    expect(scene.walkCalls).toStrictEqual(['start', 'start']);
    expect(statuses.map(status => status && [status.kind, status.id])).toStrictEqual([
      ['route', 'enter'],
      ['walk', 'walk-1'],
      ['walk', 'walk-2'],
      ['route', 'platform']
    ]);
  });

  it('页面开始别的定位：步行立即结束、不飞回；之后场景再报告的阶段、提示不再算数', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();
    roam(walkRoam());
    await settle();

    view.flyTo({ center: [119, 32], zoom: 10 });
    scene.emit('walkphase', 'walking');
    scene.emit('walknotice', 'open');
    roam(undefined);
    await settle();

    expect(scene.walkCalls).toStrictEqual(['start', 'stop false']);
    expect(statuses.map(status => status?.kind === 'walk' && status.phase)).toStrictEqual(['entering', false]);
  });
});

describe('CesiumView 步行时的小地图与完整地图（ADR 0087）', () => {
  const player = { x: 5, y: 6, floor: -5, yaw: 0.3, hfov: 1.6, target: null };

  it('场景报告的人的位置写进步行状态；被别的定位接管后不再算数', async () => {
    const { scene, view, statuses, roam } = roamSetup();
    await view.whenReady();
    roam(walkRoam());
    await settle();

    scene.emit('walkplayer', player);
    expect(view.roamStatus).toMatchObject({ kind: 'walk', player });

    view.flyTo({ center: [119, 32], zoom: 10 });
    scene.emit('walkplayer', { ...player, x: 9 });
    expect(statuses.at(-1)).toMatchObject({ player: { x: 5 } });
  });

  it('暂停变了就告诉场景；瞬移的计数变了才闪切一次；一开始就暂停的步行开始后立即暂停', async () => {
    const { scene, view, roam } = roamSetup();
    await view.whenReady();
    roam(walkRoam());
    await settle();
    const spot = { x: 3, y: 4, floor: -10 };

    roam(walkRoam({ paused: true }));
    await settle();
    roam(walkRoam({ paused: false, teleport: { count: 1, spot } }));
    await settle();
    roam(walkRoam({ paused: false, teleport: { count: 1, spot } }));
    await settle();
    roam(walkRoam({ id: 'walk-2', paused: true }));
    await settle();

    expect(scene.walkCalls).toStrictEqual([
      'start',
      'paused true',
      'paused false',
      'teleport 3,4,-10',
      'start',
      'paused true'
    ]);
  });
});
