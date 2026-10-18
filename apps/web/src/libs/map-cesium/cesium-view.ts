import { createNanoEvents } from 'nanoevents';
import {
  type CameraState,
  type FitBoundsOptions,
  type FlyToOptions,
  type LngLat,
  type MapSession,
  type MapView,
  type MapViewFailure,
  NO_SOURCE_ERRORS,
  type PickResult,
  type RenderedFeature,
  type RenderedQueryOptions,
  type ScreenBox,
  type ScreenPoint,
  type SourceErrors,
  type ViewBounds,
  type ViewState
} from '@yzt/map-core';
import { safeReporter } from '@yzt/utils';
import { CesiumSurface, type CesiumSurfaceOptions } from './cesium-surface';

/** 引擎只实现绘制与交互，生命周期由视图持有，测试可替换成窄接口假对象 */
export interface CesiumViewSurface extends Disposable {
  pause(): void;
  resume(): void;
  flyTo(target: Partial<CameraState>, options?: FlyToOptions): void;
  fitBounds(bounds: ViewBounds, options?: FitBoundsOptions): void;
  pick(point: ScreenPoint): PickResult;
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
}

interface ViewEvents {
  statechange: (state: ViewState) => void;
  resize: () => void;
  settle: () => void;
  sourceerrorchange: (errors: SourceErrors) => void;
}

// 生命周期等待只创建一次；显式保存结算函数以兼容当前 ES 类型目标
function readyResult() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export interface CesiumViewOptions {
  session: MapSession<string>;
  container: HTMLElement;
  assetBaseUrl: string;
  active?: boolean;
  onError?: (error: unknown) => void;
  createSurface?: (options: CesiumSurfaceOptions) => CesiumViewSurface;
}

/** 三维的统一视图入口，装配共享样式、相机与输入 */
export class CesiumView implements MapView {
  readonly kind = '3d';
  #sourceErrors: SourceErrors = NO_SOURCE_ERRORS;
  readonly #events = createNanoEvents<ViewEvents>();
  readonly #ready = readyResult();
  readonly #report: (error: unknown) => void;
  #surface: CesiumViewSurface | undefined;
  #state: ViewState = 'initializing';
  #failure: MapViewFailure | null = null;
  #active: boolean;

  constructor({ session, container, assetBaseUrl, active = true, onError = console.error,
    createSurface = options => new CesiumSurface(options) }: CesiumViewOptions) {
    this.#active = active;
    this.#report = safeReporter(onError, 'CesiumView');
    // 失败既作为状态也作为等待结果；调用方没有等待时不会出现未处理的拒绝
    void this.#ready.promise.catch(() => {});
    try {
      const surface = createSurface({
        container, assetBaseUrl, camera: session.camera, style: session.style, tool: session.tool, active,
        onReady: () => {
          if (this.#state === 'initializing') {
            this.#setState(this.#active ? 'ready' : 'paused');
            this.#ready.resolve();
          }
        },
        onError: error => this.#fail(error),
        onStyleError: error => {
          if (this.#state !== 'disposed' && this.#state !== 'failed') {
            this.#report(error);
          }
        },
        onSourceErrors: errors => {
          if (this.#state !== 'disposed' && this.#state !== 'failed') {
            this.#sourceErrors = errors;
            this.#notify(() => this.#events.emit('sourceerrorchange', errors));
          }
        },
        onResize: () => this.#emit('resize'),
        onSettle: () => this.#emit('settle')
      });
      // 构造期间同步报错也要释放返回的实例
      if (this.#failure) {
        surface[Symbol.dispose]();
      } else {
        this.#surface = surface;
      }
    } catch (error) {
      this.#fail(error);
    }
  }

  get state(): ViewState { return this.#state; }
  get failure(): MapViewFailure | null { return this.#failure; }
  get sourceErrors(): SourceErrors { return this.#sourceErrors; }
  whenReady(): Promise<void> { return this.#ready.promise; }

  pause(): void {
    this.#assertAlive();
    this.#active = false;
    this.#surface?.pause();
    if (this.#state === 'ready') {
      this.#setState('paused');
    }
  }

  resume(): void {
    this.#assertAlive();
    this.#active = true;
    if (this.#state === 'failed') {
      return;
    }
    this.#surface?.resume();
    if (this.#state === 'paused') {
      this.#setState('ready');
    }
  }

  flyTo(target: Partial<CameraState>, options?: FlyToOptions): void { this.#readySurface().flyTo(target, options); }
  fitBounds(bounds: ViewBounds, options?: FitBoundsOptions): void { this.#readySurface().fitBounds(bounds, options); }
  pick(point: ScreenPoint): PickResult { return this.#readySurface().pick(point); }
  project(lngLat: LngLat, height?: number): ScreenPoint | null { return this.#readySurface().project(lngLat, height); }

  /** 业务识别由后端查询负责，三维不提供二维的渲染要素 */
  queryRendered(_area: ScreenPoint | ScreenBox, _options: RenderedQueryOptions): readonly RenderedFeature[] {
    this.#readySurface();
    return [];
  }

  on<E extends keyof ViewEvents>(event: E, callback: ViewEvents[E]): () => void {
    this.#assertAlive();
    // 四种事件都只有零或一个参数；逐个隔离订阅者，不能因一个回调失败而漏掉上下文的通知
    const listener = safeReporter(value => {
      try {
        Reflect.apply(callback, undefined, [value]);
      } catch (error) {
        this.#report(error);
      }
    }, 'CesiumView.on');
    return this.#events.on(event, listener as ViewEvents[E]);
  }

  [Symbol.dispose](): void {
    if (this.#state === 'disposed') {
      return;
    }
    this.#state = 'disposed';
    this.#failure = null;
    this.#events.events = {};
    this.#ready.reject(new DOMException('CesiumView 已释放', 'AbortError'));
    this.#release();
  }

  #assertAlive(): void {
    if (this.#state === 'disposed') {
      throw new Error('CesiumView 已释放');
    }
  }

  #readySurface(): CesiumViewSurface {
    if (this.#state !== 'ready' || !this.#surface) {
      throw new Error('CesiumView 尚未就绪');
    }
    return this.#surface;
  }

  #setState(state: ViewState): void {
    this.#state = state;
    this.#notify(() => this.#events.emit('statechange', state));
  }

  #emit(event: 'resize' | 'settle'): void {
    if (this.#state === 'ready') {
      this.#notify(() => this.#events.emit(event));
    }
  }

  #notify(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.#report(error);
    }
  }

  #fail(error: unknown): void {
    if (this.#state === 'disposed' || this.#state === 'failed') {
      return;
    }
    this.#failure = { kind: 'engine', cause: 'unknown', error };
    this.#ready.reject(error);
    this.#setState('failed');
    this.#release();
    this.#report(error);
  }

  #release(): void {
    const surface = this.#surface;
    this.#surface = undefined;
    if (this.#sourceErrors.size > 0) {
      this.#sourceErrors = NO_SOURCE_ERRORS;
      this.#notify(() => this.#events.emit('sourceerrorchange', this.#sourceErrors));
    }
    try {
      surface?.[Symbol.dispose]();
    } catch (error) {
      this.#report(error);
    }
  }
}
