import {
  type CameraState,
  type FitBoundsOptions,
  type FlyToOptions,
  type LngLat,
  type MapInputEvent,
  type MapSession,
  type MapView,
  type MapViewFailure,
  NO_SCENE_STATUS,
  NO_SOURCE_ERRORS,
  type PickResult,
  type RenderedFeature,
  type RenderedQueryOptions,
  type ScreenBox,
  type SceneStatus,
  type ScreenPoint,
  type SelectedFeature,
  type SourceErrors,
  type ViewBounds,
  type ViewKind,
  type ViewState
} from '@yzt/map-core';
import { abortReason } from '@yzt/utils';
import {
  getCurrentScope,
  type InjectionKey,
  onScopeDispose,
  type Ref,
  ref,
  type ShallowRef,
  shallowReadonly,
  shallowRef
} from 'vue';
import {
  computeOverlayPadding,
  type MeasuredOverlay,
  type OverlayEdge,
  type OverlayOptions,
  type OverlayPadding,
  revealOffset
} from './overlay';

/**
 * 就绪视图的受限入口：只有拾取、投影、渲染要素查询和视点高度；移动相机通过相机操作
 * （ADR 0028 第 5 条、ADR 0039 第 4 条、ADR 0047、ADR 0080 第 6 节）
 */
export interface MapViewport {
  readonly kind: ViewKind;
  pick(point: ScreenPoint): PickResult;
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
  queryRendered(area: ScreenPoint | ScreenBox, options: RenderedQueryOptions): readonly RenderedFeature[];
  /** 视点在椭球面以上的高度，单位米；视图没有这项能力（二维）时为 null（ADR 0080 第 6 节） */
  eyeHeight(): number | null;
}

/** 移动相机的能力，只在 run 的回调期间有效，之后调用抛错（ADR 0039 第 3 条） */
export interface CameraControl {
  /** 有中心时放在避开悬浮元素后的区域中央；没传 padding 时自动避开（ADR 0029、0037），明确传入时以传入的为准 */
  flyTo(target: Partial<CameraState>, options?: FlyToOptions): void;
  /** 没传 padding 时避开登记过的悬浮元素（ADR 0029）；明确传入（包括 0）时以传入的为准 */
  fitBounds(bounds: ViewBounds, options?: FitBoundsOptions): void;
  /** 这个位置被登记的悬浮元素挡住时，平移地图（不缩放、不旋转）让它露出来，停在可视区域的边上；没被挡住时不动 */
  reveal(lngLat: LngLat): void;
}

/** 一次相机操作（ADR 0038、0039）：signal 在下一次操作开始、上下文释放时中止 */
export interface CameraOperation {
  readonly signal: AbortSignal;
  /**
   * 执行这次操作的定位，只能调用一次，回调最多执行一次：视图就绪时同步执行；没就绪时等到有视图进入 ready
   * （期间视图失败、重试、被替换都继续等，暂停不算就绪）；被作废、上下文释放时放弃。回调抛错交给 onError
   */
  run(action: (camera: CameraControl) => void): void;
}

/** 视图的生命周期；还没有视图时是 idle（ADR 0022 第 5 条） */
export type MapViewState = ViewState | 'idle';

/** 安排下一帧执行，返回取消函数 */
export type FrameScheduler = (callback: () => void) => () => void;

// 默认的下一帧：requestAnimationFrame
const animationFrame: FrameScheduler = callback => {
  const id = requestAnimationFrame(() => callback());
  return () => cancelAnimationFrame(id);
};

/** 子孙组件通过 useMap 拿到的只读上下文 */
export interface MapContext {
  /** 当前显示二维还是三维（ADR 0079 第 8 节）：下面的视图、状态、失败、数据源错误、指针都只反映这一种视图 */
  readonly dimension: Readonly<Ref<ViewKind>>;
  /** 切换二维、三维：当前的视图暂停，另一种视图恢复；还没有这种视图时状态是 idle，等它的画布挂上 */
  setDimension(kind: ViewKind): void;
  /** 就绪的视图，只在视图为 ready 时有值（ADR 0039 第 4 条） */
  readonly view: Readonly<ShallowRef<MapViewport | null>>;
  readonly viewState: Readonly<Ref<MapViewState>>;
  /** 视图失败的原因，只在 failed 时有值（ADR 0030） */
  readonly failure: Readonly<ShallowRef<MapViewFailure | null>>;
  /** 当前视图的数据源错误（ADR 0041 第 5 节）；没有视图时为空，替换视图后从新视图的记录开始 */
  readonly sourceErrors: Readonly<ShallowRef<SourceErrors>>;
  /** 当前视图报告的三维内容状态（ADR 0081 第 2 节）；二维、没有视图时为空 */
  readonly sceneStatus: Readonly<ShallowRef<SceneStatus>>;
  /** 引擎失败后重新创建视图；其他时候什么也不做（样式失败会在出现新版本时自动恢复） */
  retry(): void;
  /**
   * 等到有视图且这一轮加载完成；视图失败时以原因结束；等待的视图被卸下或替换、上下文释放时以 AbortError 结束，
   * signal 中止时以它的原因结束。等待绑定具体的视图实例，旧视图就绪不算新视图就绪。定位不用它，用相机操作
   */
  whenReady(signal?: AbortSignal): Promise<void>;
  /**
   * 等到视图下一次画面稳定（没有动画，视野里的瓦片都已画出），用于加载耗时的标记；没有视图时等视图挂上。
   * 等待绑定具体的视图实例：它被卸下或替换、上下文释放时以 AbortError 结束，signal 中止时以它的原因结束
   */
  whenSettled(signal?: AbortSignal): Promise<void>;
  /** 在调用方的作用域里订阅相机，作用域销毁时取消 */
  useCamera(): Readonly<ShallowRef<CameraState>>;
  /** 屏幕投影的修订号：相机变化、画布尺寸变化时加 1；按屏幕位置摆放的浮层依赖它重新投影 */
  readonly projectionRevision: Readonly<Ref<number>>;
  /**
   * 鼠标在当前视图画布上的位置（ADR 0053 第 5 节），一帧最多更新一次；离开画布、视图不在就绪、卸下视图时为 null。
   * 来自工具模型的输入事件，和当前工具无关
   */
  readonly pointer: Readonly<ShallowRef<ScreenPoint | null>>;
  /**
   * 开始一次相机操作（ADR 0038、0039）：之前没完成的操作作废，下一次操作（包括用户开始拖动、缩放）开始时这一次作废。
   * 要先异步准备数据的定位（如区划定位等边界）在开始时调用，准备好后 run
   */
  beginCameraOperation(): CameraOperation;
  /** 当前这次相机操作，不开始新的操作，同一次操作返回同一个对象：页面初始化的定位在它下面 run，被用户的操作作废就让步 */
  currentCameraOperation(): CameraOperation;
  /** 等于 beginCameraOperation().run(action) */
  runCameraOperation(action: (camera: CameraControl) => void): void;
  /** 量出登记过的悬浮元素此刻占用的部分，算出定位用的 padding；还没有画布时四边都是边距 */
  overlayPadding(): OverlayPadding;
  /** 当前工具的 ID（ADR 0034） */
  readonly activeTool: Readonly<Ref<string>>;
  /** 激活工具，旧工具先退出；未登记时抛错 */
  activateTool(id: string): void;
  /** 让正在激活的工具退出：临时任务回到上一个常驻模式，常驻模式回到移动；没有激活时什么也不做 */
  releaseTool(id: string): void;
  /** 会话里选中的要素（ADR 0047 第 4 节） */
  readonly selection: Readonly<ShallowRef<readonly SelectedFeature[]>>;
  /** 替换选中的要素；同一个要素出现两次时抛错 */
  select(features: readonly SelectedFeature[]): void;
  clearSelection(): void;
}

// 挂上的视图；detached 在卸下时中止，等它就绪的 whenReady 随之以 AbortError 结束
interface AttachedView {
  readonly view: MapView;
  readonly viewport: MapViewport;
  readonly canvas: HTMLElement;
  readonly unsubscribe: () => void;
  readonly detached: AbortController;
}

interface OverlayEntry {
  readonly target: Readonly<Ref<HTMLElement | null | undefined>>;
  readonly edge: OverlayEdge;
}

function createViewport(view: MapView): MapViewport {
  return Object.freeze({
    kind: view.kind,
    pick: (point: ScreenPoint) => view.pick(point),
    project: (lngLat: LngLat, height?: number) => view.project(lngLat, height),
    queryRendered: (area: ScreenPoint | ScreenBox, options: RenderedQueryOptions) => view.queryRendered(area, options),
    eyeHeight: () => view.eyeHeight?.() ?? null
  });
}

// 任一 signal 中止时以它的原因结束；结束后移除监听
function abortable<T>(promise: Promise<T>, signals: readonly AbortSignal[]): Promise<T> {
  const aborted = signals.find(signal => signal.aborted);
  if (aborted) {
    return Promise.reject(abortReason(aborted));
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      for (const signal of signals) {
        signal.removeEventListener('abort', onAbort);
      }
    };
    // 中止时也要清理：被等待的 Promise 可能永远不结束（例如一直等不到视图），监听不能留在另一个 signal 上
    const onAbort = (event: Event) => {
      cleanup();
      reject(abortReason(event.target as AbortSignal));
    };
    for (const signal of signals) {
      signal.addEventListener('abort', onAbort);
    }
    promise.finally(cleanup).then(resolve, reject);
  });
}

/** map-vue 内部的完整上下文：会话、当前视图与对外的只读上下文；随 provideMap 所在的组件释放 */
export class MapContextState implements Disposable {
  readonly session: MapSession<string>;
  readonly onError: (error: unknown) => void;
  readonly context: MapContext;
  readonly #viewport = shallowRef<MapViewport | null>(null);
  readonly #viewState = ref<MapViewState>('idle');
  readonly #failure = shallowRef<MapViewFailure | null>(null);
  readonly #sourceErrors = shallowRef<SourceErrors>(NO_SOURCE_ERRORS);
  readonly #sceneStatus = shallowRef<SceneStatus>(NO_SCENE_STATUS);
  readonly #retryRequests = ref(0);
  readonly #activeTool: Ref<string>;
  readonly #unsubscribeTool: () => void;
  readonly #selection: ShallowRef<readonly SelectedFeature[]>;
  readonly #unsubscribeSelection: () => void;
  readonly #projectionRevision = ref(0);
  readonly #unsubscribeCamera: () => void;
  readonly #pointer = shallowRef<ScreenPoint | null>(null);
  readonly #unsubscribeInput: () => void;
  readonly #requestFrame: FrameScheduler;
  // 这一帧要写入的位置和取消函数；一帧里多次移动只记最后一次
  #nextPointer: ScreenPoint | null = null;
  #cancelPointerFrame: (() => void) | null = null;
  readonly #lifetime = new AbortController();
  // 还没有视图时调用 whenReady 的等待者，视图挂上时依次通知
  readonly #waiting = new Set<(attached: AttachedView) => void>();
  // 等视图就绪的相机操作：操作一个接一个作废、每个只能 run 一次，所以同一时间最多一个（ADR 0039 第 3 条）
  #pending: (() => void) | null = null;
  // 每次相机操作对应一个对象，run 只能调用一次
  readonly #operations = new WeakMap<AbortSignal, CameraOperation>();
  readonly #overlays = new Set<OverlayEntry>();
  readonly #overlayOptions: Required<OverlayOptions>;
  // 每种视图一个画布；只有当前种类的视图生效，其他的暂停
  readonly #views = new Map<ViewKind, AttachedView>();
  readonly #dimension = ref<ViewKind>('2d');
  // 所在页面没有被缓存停用（ADR 0063）：停用时所有视图都暂停
  #pageActive = true;
  // 当前视图换了（切换种类、卸下）时中止：绑定在旧视图上的等待以 AbortError 结束
  #lease = new AbortController();

  constructor(
    session: MapSession<string>,
    onError: (error: unknown) => void,
    overlayOptions: Required<OverlayOptions>,
    requestFrame: FrameScheduler = animationFrame
  ) {
    this.session = session;
    this.onError = onError;
    this.#overlayOptions = overlayOptions;
    this.#requestFrame = requestFrame;
    // 工具模型在会话里，这里只把当前工具桥接成 Vue 的状态；切换由工具模型保证同一时间只有一个
    this.#activeTool = ref(session.tool.active);
    this.#unsubscribeTool = session.tool.on('change', ({ active }) => (this.#activeTool.value = active));
    // 选择状态同样只桥接：会话整体替换，这里跟着换
    this.#selection = shallowRef(session.selection.current);
    this.#unsubscribeSelection = session.selection.on('change', features => (this.#selection.value = features));
    this.#unsubscribeCamera = session.camera.on('change', () => this.#projectionRevision.value++);
    this.#unsubscribeInput = session.tool.on('input', (event, kind) => this.#onInput(event, kind));
    this.context = Object.freeze({
      dimension: shallowReadonly(this.#dimension),
      setDimension: (kind: ViewKind) => this.#setDimension(kind),
      view: shallowReadonly(this.#viewport),
      viewState: shallowReadonly(this.#viewState),
      failure: shallowReadonly(this.#failure),
      sourceErrors: shallowReadonly(this.#sourceErrors),
      sceneStatus: shallowReadonly(this.#sceneStatus),
      retry: () => this.#retry(),
      whenReady: (signal?: AbortSignal) => this.#whenReady(signal),
      whenSettled: (signal?: AbortSignal) => this.#whenSettled(signal),
      useCamera: () => this.#useCamera(),
      projectionRevision: shallowReadonly(this.#projectionRevision),
      pointer: shallowReadonly(this.#pointer),
      beginCameraOperation: () => this.#operationOf(session.camera.beginOperation()),
      currentCameraOperation: () => this.#operationOf(session.camera.operation),
      runCameraOperation: (action: (camera: CameraControl) => void) =>
        this.#operationOf(session.camera.beginOperation()).run(action),
      overlayPadding: () => this.#overlayPadding(),
      activeTool: shallowReadonly(this.#activeTool),
      activateTool: (id: string) => session.tool.activate(id),
      releaseTool: (id: string) => session.tool.release(id),
      selection: shallowReadonly(this.#selection),
      select: (features: readonly SelectedFeature[]) => session.selection.set(features),
      clearSelection: () => session.selection.clear()
    });
  }

  /** 重新创建视图的请求次数：画布组件侦听它，变化时销毁旧视图、创建新视图 */
  get retryRequests(): Readonly<Ref<number>> {
    return this.#retryRequests;
  }

  /** 画布创建这种视图时，视图应不应该运行：页面没有停用、并且是当前显示的种类；否则以暂停状态创建 */
  shouldRun(kind: ViewKind): boolean {
    return this.#pageActive && this.#dimension.value === kind;
  }

  /** 所在页面被 KeepAlive 停用、重新激活（ADR 0063）：停用时当前视图暂停，激活时恢复；各个画布都会调用，重复调用不起作用 */
  setPageActive(active: boolean): void {
    if (this.#pageActive === active) {
      return;
    }
    this.#pageActive = active;
    const current = this.#current;
    if (current && active) {
      current.view.resume();
    } else if (current) {
      current.view.pause();
    }
  }

  /** 画布组件挂载后挂上视图和它的容器（量可视区域用）；每种视图只能有一个画布 */
  attachView(view: MapView, canvas: HTMLElement): void {
    if (this.#views.has(view.kind)) {
      throw new Error(`一个地图上下文的每种视图只能有一个画布：${view.kind}`);
    }
    const viewport = createViewport(view);
    // 不是当前种类的视图的事件不反映到上下文
    const unsubscribeState = view.on('statechange', state => {
      if (this.#current !== attached) {
        return;
      }
      this.#syncView();
      if (state === 'ready') {
        this.#pending?.();
      } else {
        this.#clearPointer();
      }
    });
    // 画布尺寸变化时相机不变，投影变了
    const unsubscribeResize = view.on('resize', () => {
      if (this.#current === attached) {
        this.#projectionRevision.value++;
      }
    });
    const unsubscribeSourceErrors = view.on('sourceerrorchange', errors => {
      if (this.#current === attached) {
        this.#sourceErrors.value = errors;
      }
    });
    // 只有三维视图有这项能力
    const unsubscribeSceneStatus = view.onSceneStatusChange?.(status => {
      if (this.#current === attached) {
        this.#sceneStatus.value = status;
      }
    });
    const unsubscribe = () => {
      unsubscribeState();
      unsubscribeResize();
      unsubscribeSourceErrors();
      unsubscribeSceneStatus?.();
    };
    const attached: AttachedView = { view, viewport, canvas, unsubscribe, detached: new AbortController() };
    this.#views.set(view.kind, attached);
    if (this.#current === attached) {
      this.#becomeCurrent(attached);
    }
  }

  /** 画布组件卸载、释放视图之前卸下 */
  detachView(view: MapView): void {
    const attached = this.#views.get(view.kind);
    if (attached?.view !== view) {
      return;
    }
    const wasCurrent = this.#current === attached;
    attached.unsubscribe();
    this.#views.delete(view.kind);
    if (wasCurrent) {
      this.#clearPointer();
      this.#syncView();
      this.#renewLease();
    }
    // 最后再中止：等待者的回调在微任务里执行，看到的已经是卸下之后的状态
    attached.detached.abort(new DOMException('等待的视图已被卸下或替换', 'AbortError'));
  }

  /** 登记悬浮元素，返回注销函数（ADR 0029） */
  registerOverlay(target: Readonly<Ref<HTMLElement | null | undefined>>, edge: OverlayEdge): () => void {
    const entry: OverlayEntry = { target, edge };
    this.#overlays.add(entry);
    return () => this.#overlays.delete(entry);
  }

  /** 等待中的 whenReady 以 AbortError 结束 */
  [Symbol.dispose](): void {
    this.#unsubscribeTool();
    this.#unsubscribeSelection();
    this.#unsubscribeCamera();
    this.#unsubscribeInput();
    this.#clearPointer();
    this.#lifetime.abort(new DOMException('地图上下文已释放', 'AbortError'));
  }

  get #current(): AttachedView | null {
    return this.#views.get(this.#dimension.value) ?? null;
  }

  // 当前视图的状态、失败原因、数据源错误和受限入口；没有当前视图时是 idle
  #syncView(): void {
    const current = this.#current;
    this.#viewState.value = current?.view.state ?? 'idle';
    this.#failure.value = current?.view.failure ?? null;
    this.#sourceErrors.value = current?.view.sourceErrors ?? NO_SOURCE_ERRORS;
    this.#sceneStatus.value = current?.view.sceneStatus ?? NO_SCENE_STATUS;
    this.#viewport.value = current?.view.state === 'ready' ? current.viewport : null;
  }

  // 成为当前视图：同步状态，交给等视图的人，就绪时执行等待中的相机操作
  #becomeCurrent(attached: AttachedView): void {
    this.#syncView();
    for (const notify of this.#waiting) {
      notify(attached);
    }
    if (attached.view.state === 'ready') {
      this.#pending?.();
    }
  }

  #renewLease(): void {
    this.#lease.abort(new DOMException('等待的视图已被卸下或替换', 'AbortError'));
    this.#lease = new AbortController();
  }

  // 切换种类：旧的当前视图暂停，新的恢复；投影跟着视图变了（ADR 0079 第 8 节）
  #setDimension(kind: ViewKind): void {
    if (this.#dimension.value === kind) {
      return;
    }
    const previous = this.#current;
    this.#dimension.value = kind;
    this.#renewLease();
    this.#clearPointer();
    if (previous && this.#pageActive) {
      previous.view.pause();
    }
    const next = this.#current;
    this.#syncView();
    this.#projectionRevision.value++;
    if (!next) {
      return;
    }
    if (this.#pageActive) {
      next.view.resume();
    }
    this.#becomeCurrent(next);
  }

  // 只跟踪当前就绪视图的指针；按键不改变位置
  #onInput(event: MapInputEvent, kind: ViewKind): void {
    if (event.type === 'key' || this.#readyView()?.view.kind !== kind) {
      return;
    }
    this.#nextPointer = event.type === 'leave' ? null : event.point;
    this.#cancelPointerFrame ??= this.#requestFrame(() => {
      this.#cancelPointerFrame = null;
      this.#pointer.value = this.#nextPointer;
    });
  }

  #clearPointer(): void {
    this.#cancelPointerFrame?.();
    this.#cancelPointerFrame = null;
    this.#nextPointer = null;
    this.#pointer.value = null;
  }

  #retry(): void {
    if (this.#failure.value?.kind === 'engine') {
      this.#retryRequests.value++;
    }
  }

  #operationOf(signal: AbortSignal): CameraOperation {
    const existing = this.#operations.get(signal);
    if (existing) {
      return existing;
    }
    let ran = false;
    const operation: CameraOperation = Object.freeze({
      signal,
      run: (action: (camera: CameraControl) => void) => {
        if (ran) {
          throw new Error('一次相机操作只能 run 一次');
        }
        ran = true;
        this.#runOperation(signal, action);
      }
    });
    this.#operations.set(signal, operation);
    return operation;
  }

  // 就绪时同步执行；否则订阅视图进入 ready，不循环调用 whenReady：失败视图的 whenReady 立即结束，循环会空转（ADR 0039 第 3 条）
  #runOperation(signal: AbortSignal, action: (camera: CameraControl) => void): void {
    const lifetime = this.#lifetime.signal;
    if (signal.aborted || lifetime.aborted) {
      return;
    }
    if (this.#readyView()) {
      this.#execute(signal, action);
      return;
    }
    // 作废、上下文释放时移出槽位并移除监听；执行前仍按规则再确认一次（ADR 0039 第 1 条第 5 点）
    const stop = () => {
      if (this.#pending === onReady) {
        this.#pending = null;
      }
      signal.removeEventListener('abort', stop);
      lifetime.removeEventListener('abort', stop);
    };
    const onReady = () => {
      stop();
      if (!signal.aborted) {
        this.#execute(signal, action);
      }
    };
    this.#pending = onReady;
    signal.addEventListener('abort', stop);
    lifetime.addEventListener('abort', stop);
  }

  #readyView(): AttachedView | null {
    return this.#viewState.value === 'ready' ? this.#current : null;
  }

  // 相机控制每次调用都确认：回调还没返回、操作没被作废、视图仍是开始执行时那个就绪的视图
  #execute(signal: AbortSignal, action: (camera: CameraControl) => void): void {
    const attached = this.#readyView();
    if (!attached) {
      return;
    }
    let running = true;
    const usable = () => {
      if (!running) {
        throw new Error('相机控制只在 run 的回调期间有效');
      }
      return !signal.aborted && this.#readyView() === attached;
    };
    const { view } = attached;
    const camera: CameraControl = Object.freeze({
      flyTo: (target: Partial<CameraState>, options?: FlyToOptions) => {
        if (usable()) {
          view.flyTo(target, { ...options, padding: options?.padding ?? this.#overlayPadding() });
        }
      },
      fitBounds: (bounds: ViewBounds, options?: FitBoundsOptions) => {
        if (usable()) {
          view.fitBounds(bounds, { ...options, padding: options?.padding ?? this.#overlayPadding() });
        }
      },
      reveal: (lngLat: LngLat) => {
        if (usable()) {
          this.#reveal(attached, lngLat);
        }
      }
    });
    try {
      action(camera);
    } catch (error) {
      this.onError(error);
    } finally {
      running = false;
    }
  }

  async #whenReady(signal?: AbortSignal): Promise<void> {
    const signals = signal ? [this.#lifetime.signal, signal] : [this.#lifetime.signal];
    const attached = this.#current ?? (await this.#nextView(signals));
    // 等的是这一个视图：它被卸下、不再是当前视图时立即结束，不等它自己的 whenReady
    await abortable(attached.view.whenReady(), [...signals, attached.detached.signal, this.#lease.signal]);
    // 上面的等待结束时监听已经移除，到这里继续执行之前，就绪的同一轮里排在后面的回调可能中止了 signal 或卸下了视图：返回前再确认
    const aborted = signals.find(item => item.aborted);
    if (aborted) {
      throw abortReason(aborted);
    }
    if (this.#current !== attached) {
      throw new DOMException('等待的视图已被卸下或替换', 'AbortError');
    }
  }

  async #whenSettled(signal?: AbortSignal): Promise<void> {
    const signals = signal ? [this.#lifetime.signal, signal] : [this.#lifetime.signal];
    const attached = this.#current ?? (await this.#nextView(signals));
    const bound = [...signals, attached.detached.signal, this.#lease.signal];
    // 等到视图之后、继续执行之前可能已经卸下（随后就会释放，不能再订阅）
    const aborted = bound.find(item => item.aborted);
    if (aborted) {
      throw abortReason(aborted);
    }
    let resolveSettled: (() => void) | undefined;
    const settled = new Promise<void>(resolve => (resolveSettled = resolve));
    // 在 Promise 外面订阅：订阅出错时 whenSettled 以这个错误结束，不会变成没人处理的拒绝
    const unsubscribe = attached.view.on('settle', () => resolveSettled?.());
    try {
      await abortable(settled, bound);
    } finally {
      unsubscribe();
    }
  }

  #nextView(signals: readonly AbortSignal[]): Promise<AttachedView> {
    let notify: ((attached: AttachedView) => void) | undefined;
    const attached = new Promise<AttachedView>(resolve => {
      notify = resolve;
      this.#waiting.add(resolve);
    });
    // 中止时从等待者里移除，免得一直留在集合里
    return abortable(attached, signals).finally(() => {
      if (notify) {
        this.#waiting.delete(notify);
      }
    });
  }

  // 定位时现量现算：不在文档里的元素不算，尺寸为 0、和画布不相交的由纯函数排除
  #measureOverlays(): MeasuredOverlay[] {
    return [...this.#overlays].flatMap(({ target, edge }) => {
      const element = target.value;
      return element?.isConnected ? [{ edge, box: element.getBoundingClientRect() }] : [];
    });
  }

  #overlayPadding(): OverlayPadding {
    const canvas = this.#current?.canvas.getBoundingClientRect();
    if (!canvas) {
      const { edgePadding } = this.#overlayOptions;
      return { top: edgePadding, right: edgePadding, bottom: edgePadding, left: edgePadding };
    }
    return computeOverlayPadding(canvas, this.#measureOverlays(), this.#overlayOptions);
  }

  // 平移后的画布中心对应的位置作为新的中心，中心不加 padding；投影不到（三维在背面）、拾取不到时不动
  #reveal({ view, canvas }: AttachedView, lngLat: LngLat): void {
    const point = view.project(lngLat);
    if (!point) {
      return;
    }
    const box = canvas.getBoundingClientRect();
    const offset = revealOffset(point, box, this.#measureOverlays(), this.#overlayOptions);
    if (!offset) {
      return;
    }
    const middle = { x: (box.right - box.left) / 2, y: (box.bottom - box.top) / 2 };
    const center = view.pick({ x: middle.x - offset.x, y: middle.y - offset.y });
    if (center.kind === 'hit') {
      view.flyTo({ center: center.lngLat });
    }
  }

  #useCamera(): Readonly<ShallowRef<CameraState>> {
    if (!getCurrentScope()) {
      throw new Error('useCamera 只能在组件的 setup 或 effectScope 中调用');
    }
    const camera = shallowRef(this.session.camera.current);
    const unsubscribe = this.session.camera.on('change', ({ state }) => (camera.value = state));
    onScopeDispose(unsubscribe);
    return shallowReadonly(camera);
  }
}

export const INTERNAL_MAP_CONTEXT: InjectionKey<MapContextState> = Symbol('map-vue');
