import {
  type MapView,
  type MapViewFailure,
  NO_SOURCE_ERRORS,
  type PickResult,
  type RenderedFeature,
  type ScreenPoint,
  type SourceErrors,
  type Unsubscribe,
  type ViewKind,
  type ViewState
} from '@yzt/map-core';

/**
 * 框架加载失败时挂上的视图（ADR 0079 第 8 节）：一直处于引擎失败状态，页面照常显示失败和重试；
 * 重试时画布释放它、重新加载
 */
export class FailedView implements MapView {
  readonly kind: ViewKind;
  readonly failure: MapViewFailure;
  readonly sourceErrors: SourceErrors = NO_SOURCE_ERRORS;
  #state: ViewState = 'failed';
  readonly #ready: Promise<void>;

  constructor(kind: ViewKind, error: unknown) {
    this.kind = kind;
    this.failure = { kind: 'engine', cause: 'unknown', error };
    this.#ready = Promise.reject(error instanceof Error ? error : new Error(`${kind} 视图加载失败`, { cause: error }));
    // 没人等待时被拒绝也不报"未处理的拒绝"，等待的人照样收到错误
    this.#ready.catch(() => undefined);
  }

  get state(): ViewState {
    return this.#state;
  }

  whenReady(): Promise<void> {
    return this.#ready;
  }

  pause(): void {}

  resume(): void {}

  flyTo(): void {
    this.#unavailable();
  }

  fitBounds(): void {
    this.#unavailable();
  }

  pick(): PickResult {
    return this.#unavailable();
  }

  project(): ScreenPoint | null {
    return this.#unavailable();
  }

  queryRendered(): RenderedFeature[] {
    return this.#unavailable();
  }

  // 状态永远不变，不会发出任何事件
  on(): Unsubscribe {
    return () => undefined;
  }

  [Symbol.dispose](): void {
    this.#state = 'disposed';
  }

  #unavailable(): never {
    throw new Error(`${this.kind} 视图加载失败，只能在 ready 时定位、拾取、投影和查询`);
  }
}
