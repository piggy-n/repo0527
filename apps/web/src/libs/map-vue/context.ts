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

/** 视图的受限入口：只转发定位等使用方需要的能力，暂停、恢复、释放由 map-vue 自己负责（ADR 0028 第 5 条） */
export interface MapViewport {
  readonly kind: ViewKind;
  flyTo(target: Partial<CameraState>, options?: FlyToOptions): void;
  /** 没传 padding 时避开登记过的悬浮元素（ADR 0029）；明确传入（包括 0）时以传入的为准 */
  fitBounds(bounds: ViewBounds, options?: FitBoundsOptions): void;
  /** 只在视图就绪时可用 */
  pick(point: ScreenPoint): PickResult;
  /** 只在视图就绪时可用 */
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
}

/** 视图的生命周期；还没有视图时是 idle（ADR 0022 第 5 条） */
export type MapViewState = ViewState | 'idle';

/** 子孙组件通过 useMap 拿到的只读上下文 */
export interface MapContext {
  /** 当前显示的视图；画布还没挂载、已卸载时为 null */
  readonly view: Readonly<ShallowRef<MapViewport | null>>;
  readonly viewState: Readonly<Ref<MapViewState>>;
  /** 视图失败的原因，只在 failed 时有值（ADR 0030） */
  readonly failure: Readonly<ShallowRef<MapViewFailure | null>>;
  /** 引擎失败后重新创建视图；其他时候什么也不做（样式失败会在出现新版本时自动恢复） */
  retry(): void;
  /**
   * 等到有视图且这一轮加载完成；视图失败时以原因结束；等待的视图被卸下或替换、上下文释放时以 AbortError 结束，
   * signal 中止时以它的原因结束。等待绑定具体的视图实例，旧视图就绪不算新视图就绪
   */
  whenReady(signal?: AbortSignal): Promise<void>;
  /** 在调用方的作用域里订阅相机，作用域销毁时取消 */
  useCamera(): Readonly<ShallowRef<CameraState>>;
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
  readonly canvas: HTMLElement;
  readonly unsubscribe: () => void;
  readonly detached: AbortController;
}

interface OverlayEntry {
  readonly target: Readonly<Ref<HTMLElement | null | undefined>>;
  readonly edge: OverlayEdge;
}

function createViewport(view: MapView, overlayPadding: () => OverlayPadding): MapViewport {
  return Object.freeze({
    kind: view.kind,
    flyTo: (target: Partial<CameraState>, options?: FlyToOptions) => view.flyTo(target, options),
    fitBounds: (bounds: ViewBounds, options?: FitBoundsOptions) =>
      view.fitBounds(bounds, { ...options, padding: options?.padding ?? overlayPadding() }),
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
  readonly #lifetime = new AbortController();
  // 还没有视图时调用 whenReady 的等待者，视图挂上时依次通知
  readonly #waiting = new Set<(attached: AttachedView) => void>();
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
    this.context = Object.freeze({
      view: shallowReadonly(this.#viewport),
      viewState: shallowReadonly(this.#viewState),
      failure: shallowReadonly(this.#failure),
      retry: () => this.#retry(),
      whenReady: (signal?: AbortSignal) => this.#whenReady(signal),
      useCamera: () => this.#useCamera(),
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
    const unsubscribe = view.on('statechange', state => {
      this.#viewState.value = state;
      this.#failure.value = view.failure;
    });
    const attached: AttachedView = { view, canvas, unsubscribe, detached: new AbortController() };
    this.#view = attached;
    this.#viewState.value = view.state;
    this.#failure.value = view.failure;
    this.#viewport.value = createViewport(view, () => this.#overlayPadding());
    for (const notify of this.#waiting) {
      notify(attached);
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
    this.#lifetime.abort(new DOMException('地图上下文已释放', 'AbortError'));
  }

  #retry(): void {
    if (this.#failure.value?.kind === 'engine') {
      this.#retryRequests.value++;
    }
  }

  async #whenReady(signal?: AbortSignal): Promise<void> {
    const signals = signal ? [this.#lifetime.signal, signal] : [this.#lifetime.signal];
    const attached = this.#view ?? (await this.#nextView(signals));
    // 等的是这一个视图：它被卸下时立即结束，不等它自己的 whenReady
    await abortable(attached.view.whenReady(), [...signals, attached.detached.signal]);
    // 纵深防御：上面的等待结束后、这里继续执行之前隔着一两个微任务，期间被替换时监听已经移除，返回前再确认等的仍是当前视图。
    // 这个窗口取决于微任务的个数，测试无法稳定命中
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
