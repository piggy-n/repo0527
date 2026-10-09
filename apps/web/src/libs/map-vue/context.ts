import type {
  CameraState,
  FitBoundsOptions,
  FlyToOptions,
  MapSession,
  MapView,
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

/** 视图的受限入口：只转发定位等使用方需要的能力，暂停、恢复、释放由 map-vue 自己负责（ADR 0028 第 5 条） */
export interface MapViewport {
  readonly kind: ViewKind;
  flyTo(target: Partial<CameraState>, options?: FlyToOptions): void;
  fitBounds(bounds: ViewBounds, options?: FitBoundsOptions): void;
}

/** 视图的生命周期；还没有视图时是 idle（ADR 0022 第 5 条） */
export type MapViewState = ViewState | 'idle';

/** 子孙组件通过 useMap 拿到的只读上下文 */
export interface MapContext {
  /** 当前显示的视图；画布还没挂载、已卸载时为 null */
  readonly view: Readonly<ShallowRef<MapViewport | null>>;
  readonly viewState: Readonly<Ref<MapViewState>>;
  /** 等到有视图且这一轮加载完成；视图失败时以原因结束，视图或上下文释放时以 AbortError 结束，signal 中止时以它的原因结束 */
  whenReady(signal?: AbortSignal): Promise<void>;
  /** 在调用方的作用域里订阅相机，作用域销毁时取消 */
  useCamera(): Readonly<ShallowRef<CameraState>>;
}

function createViewport(view: MapView): MapViewport {
  return Object.freeze({
    kind: view.kind,
    flyTo: (target: Partial<CameraState>, options?: FlyToOptions) => view.flyTo(target, options),
    fitBounds: (bounds: ViewBounds, options?: FitBoundsOptions) => view.fitBounds(bounds, options)
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
  readonly #lifetime = new AbortController();
  // 还没有视图时调用 whenReady 的等待者，视图挂上时依次通知
  readonly #waiting = new Set<(view: MapView) => void>();
  #view: { readonly view: MapView; readonly unsubscribe: () => void } | null = null;

  constructor(session: MapSession<string>, onError: (error: unknown) => void) {
    this.session = session;
    this.onError = onError;
    this.context = Object.freeze({
      view: shallowReadonly(this.#viewport),
      viewState: shallowReadonly(this.#viewState),
      whenReady: (signal?: AbortSignal) => this.#whenReady(signal),
      useCamera: () => this.#useCamera()
    });
  }

  /** 画布组件挂载后挂上视图；目前一个上下文只有一个视图 */
  attachView(view: MapView): void {
    if (this.#view) {
      throw new Error('一个地图上下文只能有一个画布');
    }
    const unsubscribe = view.on('statechange', state => (this.#viewState.value = state));
    this.#view = { view, unsubscribe };
    this.#viewState.value = view.state;
    this.#viewport.value = createViewport(view);
    for (const notify of this.#waiting) {
      notify(view);
    }
  }

  /** 画布组件卸载、释放视图之前卸下 */
  detachView(view: MapView): void {
    if (this.#view?.view !== view) {
      return;
    }
    this.#view.unsubscribe();
    this.#view = null;
    this.#viewport.value = null;
    this.#viewState.value = 'idle';
  }

  /** 等待中的 whenReady 以 AbortError 结束 */
  [Symbol.dispose](): void {
    this.#lifetime.abort(new DOMException('地图上下文已释放', 'AbortError'));
  }

  async #whenReady(signal?: AbortSignal): Promise<void> {
    const signals = signal ? [this.#lifetime.signal, signal] : [this.#lifetime.signal];
    const view = this.#view?.view ?? (await this.#nextView(signals));
    await abortable(view.whenReady(), signals);
  }

  #nextView(signals: readonly AbortSignal[]): Promise<MapView> {
    let notify: ((view: MapView) => void) | undefined;
    const attached = new Promise<MapView>(resolve => {
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
