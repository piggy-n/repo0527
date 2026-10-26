import {
  type CameraCause,
  type CameraState,
  canTransition,
  deferred,
  type FitBoundsOptions,
  type FlyToOptions,
  type LiveViewState,
  type LngLat,
  type MapInputEvent,
  type MapSession,
  type MapView,
  type MapViewFailure,
  NO_SOURCE_ERRORS,
  type PickResult,
  type RenderedFeature,
  type ScreenPoint,
  type SourceErrors,
  type ToolView,
  type Unsubscribe,
  type ViewBounds,
  type ViewState
} from '@yzt/map-core';
import { safeReporter } from '@yzt/utils';
import { createNanoEvents } from 'nanoevents';
import { fitBoundsCamera, paddedCenter } from './camera-fit';
import { type CreateScene, type SceneLike, type ScenePose, WebGLUnavailableError } from './scene-like';
import { planSceneStyle, type UnsupportedLayer } from './scene-style';

export interface CesiumViewOptions<G extends string> {
  readonly session: MapSession<G>;
  readonly container: HTMLElement;
  /** 创建后是否显示，默认 true；为 false 时创建后进入 paused */
  readonly active?: boolean;
  /** 运行中的错误；默认打印到控制台 */
  readonly onError?: (error: unknown) => void;
  /** 支持清单之外的图层，每个图层报告一次（ADR 0079 第 7 节）；默认不报告 */
  readonly onUnsupported?: (layer: UnsupportedLayer) => void;
  /** 创建场景：真实的是 createCesiumScene，测试时换成假场景 */
  readonly createScene: CreateScene;
}

interface CesiumViewEvents {
  statechange: (state: ViewState) => void;
  resize: () => void;
  settle: () => void;
  sourceerrorchange: (errors: SourceErrors) => void;
}

// 离开三维时记下的精确相机；暂停期间会话的相机有了 sync 之外的变化就不能还原（ADR 0020 第 5 条）
interface SavedPose {
  readonly pose: ScenePose;
  restorable: boolean;
}

function reportToConsole(error: unknown): void {
  console.error('[CesiumView]', error);
}

/**
 * 三维视图（ADR 0024、0079）：镜像会话的样式、同步相机、把画布上的输入交给工具。
 * 只读会话、只写场景；用户、程序、同步引起的相机变化按 cause 写回会话
 */
export class CesiumView<const G extends string> implements MapView {
  readonly kind = '3d';
  readonly #session: MapSession<G>;
  readonly #scene: SceneLike | undefined;
  readonly #onError: (error: unknown) => void;
  readonly #onUnsupported: (layer: UnsupportedLayer) => void;
  readonly #emitter = createNanoEvents<CesiumViewEvents>();
  readonly #stack: DisposableStack;
  // 这个视图只有一轮加载：创建场景
  readonly #ready = deferred();
  #state: ViewState = 'initializing';
  #failure: MapViewFailure | null = null;
  #sourceErrors = NO_SOURCE_ERRORS;
  // 是谁在移动相机：视图自己定位时是 program、sync，其余的移动都是用户操作；相机停下后清空
  #motion: CameraCause | null = null;
  // 暂停期间样式变了，恢复时再应用
  #styleStale = false;
  #saved: SavedPose | null = null;
  readonly #reported = new Set<string>();
  // 交给工具的视图能力：只有拾取、投影和渲染要素查询（ADR 0034 第 2 条、ADR 0047 第 4 节）
  readonly #toolView: ToolView = Object.freeze({
    kind: '3d',
    pick: (point: ScreenPoint) => this.pick(point),
    project: (lngLat: LngLat, height?: number) => this.project(lngLat, height),
    queryRendered: () => []
  });

  constructor({
    session,
    container,
    active = true,
    onError = reportToConsole,
    onUnsupported = () => undefined,
    createScene
  }: CesiumViewOptions<G>) {
    this.#session = session;
    this.#onError = safeReporter(onError, 'CesiumView');
    this.#onUnsupported = safeReporter(onUnsupported, 'CesiumView');
    using stack = new DisposableStack();
    stack.defer(() => this.#ready.reject(new DOMException('CesiumView 已释放', 'AbortError')));

    let scene: SceneLike;
    try {
      scene = createScene(container);
    } catch (error) {
      // 例如不支持 WebGL：不抛出，交给 whenReady 和 statechange 表达
      this.#scene = undefined;
      this.#stack = stack.move();
      this.#fail(error);
      return;
    }
    this.#scene = scene;
    stack.use(scene);
    for (const unsubscribe of [
      scene.on('interact', () => this.#guard(() => this.#onInteract(scene))),
      scene.on('camerachange', () => this.#guard(() => this.#onCameraChange(scene))),
      scene.on('cameraidle', () => this.#guard(() => this.#onCameraIdle(scene))),
      scene.on('pointer', event => this.#guard(() => this.#onInput(event))),
      scene.on('key', key => this.#guard(() => this.#onInput({ type: 'key', key }))),
      scene.on('resize', () => this.#emitter.emit('resize')),
      scene.on('settle', () => this.#onSettle()),
      scene.on('imageryerror', (sourceId, error) => this.#recordSourceError(sourceId, error)),
      scene.on('failure', error => this.#fail(error))
    ]) {
      stack.defer(unsubscribe);
    }
    stack.defer(session.style.on('change', () => this.#guard(() => this.#onStyleChange(scene))));
    stack.defer(session.tool.on('change', () => this.#guard(() => this.#onToolChange(scene))));
    stack.defer(session.camera.on('change', ({ cause }) => this.#onSessionCamera(cause)));
    this.#stack = stack.move();

    this.#applyStyle(scene);
    if (active) {
      this.#activate(scene);
    } else {
      scene.setRendering(false);
      this.#setState('paused');
      this.#ready.resolve();
    }
  }

  get state(): ViewState {
    return this.#state;
  }

  get failure(): MapViewFailure | null {
    return this.#failure;
  }

  get sourceErrors(): SourceErrors {
    return this.#sourceErrors;
  }

  whenReady(): Promise<void> {
    return this.#ready.promise;
  }

  /** 暂停：进行中的定位直接到终点并按 program 写回，记下精确相机，停止渲染 */
  pause(): void {
    this.#assertAlive();
    const scene = this.#scene;
    if (this.#state !== 'ready' || !scene) {
      return;
    }
    if (scene.flying) {
      scene.completeFlight();
      this.#writeCamera(scene, 'program');
    }
    this.#motion = null;
    this.#saved = { pose: scene.savePose(), restorable: true };
    scene.setRendering(false);
    this.#setState('paused');
  }

  /** 恢复：先按容器调整画布，再追上暂停期间的样式变化，相机能还原就还原，否则从会话同步 */
  resume(): void {
    this.#assertAlive();
    const scene = this.#scene;
    if (this.#state !== 'paused' || !scene) {
      return;
    }
    scene.resize();
    if (this.#styleStale) {
      this.#applyStyle(scene);
    }
    this.#activate(scene);
  }

  flyTo({ center, zoom, bearing, pitch }: Partial<CameraState>, { duration, padding }: FlyToOptions = {}): void {
    const scene = this.#readyScene();
    const current = this.#session.camera.current;
    const target: CameraState = {
      center: center ?? current.center,
      zoom: zoom ?? current.zoom,
      bearing: bearing ?? current.bearing,
      pitch: pitch ?? current.pitch
    };
    // 和二维一样，padding 只决定这一次把目标放在哪里，不留在相机上（ADR 0037）
    const placed = center ? { ...target, center: paddedCenter(center, target.zoom, target.bearing, padding) } : target;
    this.#move(scene, 'program', () => scene.flyTo(placed, duration));
  }

  fitBounds(bounds: ViewBounds, { padding, maxZoom, duration, pitch }: FitBoundsOptions = {}): void {
    const scene = this.#readyScene();
    const camera = fitBoundsCamera(bounds, scene.size(), {
      padding,
      maxZoom,
      pitch: pitch ?? this.#session.camera.current.pitch
    });
    this.#move(scene, 'program', () => scene.flyTo(camera, duration));
  }

  pick(point: ScreenPoint): PickResult {
    return this.#readyScene().pick(point);
  }

  project(lngLat: LngLat, height?: number): ScreenPoint | null {
    return this.#readyScene().project(lngLat, height);
  }

  /** 三维没有渲染要素可查（ADR 0047 第 4 节） */
  queryRendered(): RenderedFeature[] {
    this.#readyScene();
    return [];
  }

  on<E extends keyof CesiumViewEvents>(event: E, callback: CesiumViewEvents[E]): Unsubscribe {
    this.#assertAlive();
    return this.#emitter.on(event, callback);
  }

  [Symbol.dispose](): void {
    if (this.#state === 'disposed') {
      return;
    }
    this.#state = 'disposed';
    this.#failure = null;
    this.#sourceErrors = NO_SOURCE_ERRORS;
    this.#emitter.events = {};
    this.#stack.dispose();
  }

  #activate(scene: SceneLike): void {
    const saved = this.#saved;
    this.#saved = null;
    scene.setRendering(true);
    if (saved?.restorable) {
      scene.restorePose(saved.pose);
      // 还原的是三维自己的精确相机，会话按它换算后的值同步
      this.#writeCamera(scene, 'sync');
    } else {
      this.#move(scene, 'sync', () => scene.jumpTo(this.#session.camera.current));
    }
    this.#applyTool(scene);
    this.#setState('ready');
    this.#ready.resolve();
  }

  // 视图自己移动相机：在相机停下之前，这次移动引起的变化按 cause 写回；jumpTo 是同步的，立即写一次
  #move(scene: SceneLike, cause: CameraCause, move: () => void): void {
    this.#motion = cause;
    move();
    this.#writeCamera(scene, cause);
  }

  // 用户在画布上按下鼠标、滚动滚轮：进行中的定位停下，接下来的移动是用户操作
  #onInteract(scene: SceneLike): void {
    if (this.#state !== 'ready') {
      return;
    }
    scene.cancelFlight();
    this.#motion = null;
  }

  // 不是视图自己发起的移动就是用户操作：第一次变化时开始一次新的相机操作（ADR 0038）
  #onCameraChange(scene: SceneLike): void {
    if (this.#state !== 'ready') {
      return;
    }
    if (this.#motion === null) {
      this.#motion = 'user';
      this.#session.camera.beginOperation();
    }
    this.#writeCamera(scene, this.#motion);
  }

  #onCameraIdle(scene: SceneLike): void {
    if (this.#state !== 'ready') {
      return;
    }
    this.#writeCamera(scene, this.#motion ?? 'user');
    this.#motion = null;
  }

  // 暂停期间会话的相机被别的视图改了：用户移动、程序定位过就不能还原离开时的精确相机
  #onSessionCamera(cause: CameraCause): void {
    if (this.#state === 'paused' && this.#saved && cause !== 'sync') {
      this.#saved.restorable = false;
    }
  }

  #writeCamera(scene: SceneLike, cause: CameraCause): void {
    const camera = scene.readCamera();
    if (camera) {
      this.#session.camera.set(camera, { view: '3d', cause });
    }
  }

  #onStyleChange(scene: SceneLike): void {
    if (this.#state === 'ready') {
      this.#applyStyle(scene);
    } else if (this.#state === 'paused') {
      this.#styleStale = true;
    }
  }

  // 按支持清单把样式镜像到场景；不支持的图层每个只报告一次，数据源不在了的错误一并忘掉
  #applyStyle(scene: SceneLike): void {
    this.#styleStale = false;
    const plan = planSceneStyle(this.#session.style.current);
    scene.setImagery(plan.imagery);
    scene.setBaseColor(plan.baseColor);
    for (const layer of plan.unsupported) {
      if (!this.#reported.has(layer.layerId)) {
        this.#reported.add(layer.layerId);
        this.#onUnsupported(layer);
      }
    }
    const sources = new Set(plan.imagery.map(({ sourceId }) => sourceId));
    const remaining = [...this.#sourceErrors].filter(([sourceId]) => sources.has(sourceId));
    if (remaining.length !== this.#sourceErrors.size) {
      this.#setSourceErrors(remaining.length > 0 ? new Map(remaining) : NO_SOURCE_ERRORS);
    }
  }

  // 只有就绪的视图把输入交给工具：二三维切换时只有当前显示的视图在转交（ADR 0034 第 3 条）
  #onInput(event: MapInputEvent): void {
    if (this.#state === 'ready') {
      this.#session.tool.dispatch(event, this.#toolView);
    }
  }

  #onToolChange(scene: SceneLike): void {
    if (this.#state === 'ready') {
      this.#applyTool(scene);
    }
  }

  // 光标和手势是当前工具的声明（ADR 0079 第 6 节）；临时任务把焦点移到画布上，Esc 才能直接退出
  #applyTool(scene: SceneLike): void {
    const { gestures, cursor, persistent } = this.#session.tool.activeTool;
    scene.setCursor(cursor);
    scene.setGestures({ drag: gestures?.dragPan !== false });
    if (!persistent) {
      scene.focus();
    }
  }

  // 暂停时显示的是另一个视图，不算画面稳定
  #onSettle(): void {
    if (this.#state === 'ready') {
      this.#emitter.emit('settle');
    }
  }

  // 每个数据源只记第一条
  #recordSourceError(sourceId: string, error: unknown): void {
    if (this.#sourceErrors.has(sourceId)) {
      return;
    }
    this.#setSourceErrors(new Map([...this.#sourceErrors, [sourceId, error]]));
  }

  #setSourceErrors(errors: SourceErrors): void {
    this.#sourceErrors = errors;
    this.#emitter.emit('sourceerrorchange', errors);
  }

  #readyScene(): SceneLike {
    this.#assertAlive();
    if (this.#state !== 'ready' || !this.#scene) {
      throw new Error(`CesiumView 当前状态为 ${this.#state}，只能在 ready 时定位、拾取、投影和查询`);
    }
    return this.#scene;
  }

  // 创建场景失败、渲染出错都是引擎失败：不能恢复，只能释放后重新创建视图（ADR 0030）
  #fail(error: unknown): void {
    this.#ready.reject(error);
    const cause = error instanceof WebGLUnavailableError ? 'webgl-unavailable' : 'unknown';
    this.#setState('failed', { kind: 'engine', cause, error });
    this.#onError(error);
  }

  #setState(state: LiveViewState, failure: MapViewFailure | null = null): void {
    const nextFailure = state === 'failed' ? failure : null;
    if (this.#state === state && this.#failure === nextFailure) {
      return;
    }
    if (!canTransition(this.#state, this.#failure, state)) {
      this.#onError(new Error(`CesiumView 不能从 ${this.#state} 转换到 ${state}`));
      return;
    }
    this.#state = state;
    this.#failure = nextFailure;
    this.#emitter.emit('statechange', state);
  }

  // 场景的事件回调里不能抛错，否则会打断它自己的事件分发
  #guard(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.#onError(error);
    }
  }

  #assertAlive(): void {
    if (this.#state === 'disposed') {
      throw new Error('CesiumView 已释放');
    }
  }
}
