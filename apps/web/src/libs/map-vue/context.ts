import type {
  CameraState,
  FitBoundsOptions,
  FlyToOptions,
  LngLat,
  MapSession,
  MapView,
  MapViewFailure,
  PickResult,
  ScreenPoint,
  ViewBounds,
  ViewKind,
  ViewState
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
import { computeOverlayPadding, type OverlayEdge, type OverlayOptions, type OverlayPadding } from './overlay';

/** 就绪视图的受限入口：只有拾取和投影；移动相机通过相机操作（ADR 0028 第 5 条、ADR 0039 第 4 条） */
export interface MapViewport {
  readonly kind: ViewKind;
  pick(point: ScreenPoint): PickResult;
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
}

/** 移动相机的能力，只在 run 的回调期间有效，之后调用抛错（ADR 0039 第 3 条） */
export interface CameraControl {
  /** 有中心时放在避开悬浮元素后的区域中央；没传 padding 时自动避开（ADR 0029、0037），明确传入时以传入的为准 */
  flyTo(target: Partial<CameraState>, options?: FlyToOptions): void;
  /** 没传 padding 时避开登记过的悬浮元素（ADR 0029）；明确传入（包括 0）时以传入的为准 */
  fitBounds(bounds: ViewBounds, options?: FitBoundsOptions): void;
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

/** 子孙组件通过 useMap 拿到的只读上下文 */
export interface MapContext {
  /** 就绪的视图，只在视图为 ready 时有值（ADR 0039 第 4 条） */
  readonly view: Readonly<ShallowRef<MapViewport | null>>;
  readonly viewState: Readonly<Ref<MapViewState>>;
  /** 视图失败的原因，只在 failed 时有值（ADR 0030） */
  readonly failure: Readonly<ShallowRef<MapViewFailure | null>>;
  /** 引擎失败后重新创建视图；其他时候什么也不做（样式失败会在出现新版本时自动恢复） */
  retry(): void;
  /**
   * 等到有视图且这一轮加载完成；视图失败时以原因结束；等待的视图被卸下或替换、上下文释放时以 AbortError 结束，
   * signal 中止时以它的原因结束。等待绑定具体的视图实例，旧视图就绪不算新视图就绪。定位不用它，用相机操作
   */
  whenReady(signal?: AbortSignal): Promise<void>;
  /** 在调用方的作用域里订阅相机，作用域销毁时取消 */
  useCamera(): Readonly<ShallowRef<CameraState>>;
  /** 屏幕投影的修订号：相机变化、画布尺寸变化时加 1；按屏幕位置摆放的浮层依赖它重新投影 */
  readonly projectionRevision: Readonly<Ref<number>>;
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
    project: (lngLat: LngLat, height?: number) => view.project(lngLat, height)
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
  readonly #retryRequests = ref(0);
  readonly #activeTool: Ref<string>;
  readonly #unsubscribeTool: () => void;
  readonly #projectionRevision = ref(0);
  readonly #unsubscribeCamera: () => void;
  readonly #lifetime = new AbortController();
  // 还没有视图时调用 whenReady 的等待者，视图挂上时依次通知
  readonly #waiting = new Set<(attached: AttachedView) => void>();
  // 等视图就绪的相机操作：操作一个接一个作废、每个只能 run 一次，所以同一时间最多一个（ADR 0039 第 3 条）
  #pending: (() => void) | null = null;
  // 每次相机操作对应一个对象，run 只能调用一次
  readonly #operations = new WeakMap<AbortSignal, CameraOperation>();
  readonly #overlays = new Set<OverlayEntry>();
  readonly #overlayOptions: Required<OverlayOptions>;
  #view: AttachedView | null = null;

  constructor(
    session: MapSession<string>,
    onError: (error: unknown) => void,
    overlayOptions: Required<OverlayOptions>
  ) {
    this.session = session;
    this.onError = onError;
    this.#overlayOptions = overlayOptions;
    // 工具模型在会话里，这里只把当前工具桥接成 Vue 的状态；切换由工具模型保证同一时间只有一个
    this.#activeTool = ref(session.tool.active);
    this.#unsubscribeTool = session.tool.on('change', ({ active }) => (this.#activeTool.value = active));
    this.#unsubscribeCamera = session.camera.on('change', () => this.#projectionRevision.value++);
    this.context = Object.freeze({
      view: shallowReadonly(this.#viewport),
      viewState: shallowReadonly(this.#viewState),
      failure: shallowReadonly(this.#failure),
      retry: () => this.#retry(),
      whenReady: (signal?: AbortSignal) => this.#whenReady(signal),
      useCamera: () => this.#useCamera(),
      projectionRevision: shallowReadonly(this.#projectionRevision),
      beginCameraOperation: () => this.#operationOf(session.camera.beginOperation()),
      currentCameraOperation: () => this.#operationOf(session.camera.operation),
      runCameraOperation: (action: (camera: CameraControl) => void) =>
        this.#operationOf(session.camera.beginOperation()).run(action),
      overlayPadding: () => this.#overlayPadding(),
      activeTool: shallowReadonly(this.#activeTool),
      activateTool: (id: string) => session.tool.activate(id),
      releaseTool: (id: string) => session.tool.release(id)
    });
  }

  /** 重新创建视图的请求次数：画布组件侦听它，变化时销毁旧视图、创建新视图 */
  get retryRequests(): Readonly<Ref<number>> {
    return this.#retryRequests;
  }

  /** 画布组件挂载后挂上视图和它的容器（量可视区域用）；目前一个上下文只有一个视图 */
  attachView(view: MapView, canvas: HTMLElement): void {
    if (this.#view) {
      throw new Error('一个地图上下文只能有一个画布');
    }
    const viewport = createViewport(view);
    const unsubscribeState = view.on('statechange', state => {
      this.#viewState.value = state;
      this.#failure.value = view.failure;
      this.#viewport.value = state === 'ready' ? viewport : null;
      if (state === 'ready') {
        this.#pending?.();
      }
    });
    // 画布尺寸变化时相机不变，投影变了
    const unsubscribeResize = view.on('resize', () => this.#projectionRevision.value++);
    const unsubscribe = () => {
      unsubscribeState();
      unsubscribeResize();
    };
    const attached: AttachedView = { view, viewport, canvas, unsubscribe, detached: new AbortController() };
    this.#view = attached;
    this.#viewState.value = view.state;
    this.#failure.value = view.failure;
    this.#viewport.value = view.state === 'ready' ? viewport : null;
    for (const notify of this.#waiting) {
      notify(attached);
    }
    if (view.state === 'ready') {
      this.#pending?.();
    }
  }

  /** 画布组件卸载、释放视图之前卸下 */
  detachView(view: MapView): void {
    if (this.#view?.view !== view) {
      return;
    }
    const attached = this.#view;
    attached.unsubscribe();
    this.#view = null;
    this.#viewport.value = null;
    this.#viewState.value = 'idle';
    this.#failure.value = null;
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
    this.#unsubscribeCamera();
    this.#lifetime.abort(new DOMException('地图上下文已释放', 'AbortError'));
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
    return this.#viewState.value === 'ready' ? this.#view : null;
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
    const attached = this.#view ?? (await this.#nextView(signals));
    // 等的是这一个视图：它被卸下时立即结束，不等它自己的 whenReady
    await abortable(attached.view.whenReady(), [...signals, attached.detached.signal]);
    // 上面的等待结束时监听已经移除，到这里继续执行之前，就绪的同一轮里排在后面的回调可能中止了 signal 或卸下了视图：返回前再确认
    const aborted = signals.find(item => item.aborted);
    if (aborted) {
      throw abortReason(aborted);
    }
    if (this.#view !== attached) {
      throw new DOMException('等待的视图已被卸下或替换', 'AbortError');
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
  #overlayPadding(): OverlayPadding {
    const canvas = this.#view?.canvas.getBoundingClientRect();
    if (!canvas) {
      const { edgePadding } = this.#overlayOptions;
      return { top: edgePadding, right: edgePadding, bottom: edgePadding, left: edgePadding };
    }
    const overlays = [...this.#overlays].flatMap(({ target, edge }) => {
      const element = target.value;
      return element?.isConnected ? [{ edge, box: element.getBoundingClientRect() }] : [];
    });
    return computeOverlayPadding(canvas, overlays, this.#overlayOptions);
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
