import type { MapView, ViewKind } from '@yzt/map-core';
import { abortReason, LatestController, safeReporter } from '@yzt/utils';
import { shallowReadonly, shallowRef } from 'vue';
import type { MapContextState } from './context';

/** 切换反馈独立于当前视图：候选失败时当前地图仍可使用 */
export interface MapViewSwitchState {
  readonly current: ViewKind | null;
  readonly target: ViewKind;
  readonly status: 'loading' | 'ready' | 'failed';
  readonly error?: unknown;
}

/** 工厂只创建暂停的视图，运行时由应用层预先准备 */
export type LoadMapView = (kind: ViewKind) => Promise<(container: HTMLElement) => MapView>;

interface CachedView {
  readonly view: MapView;
  readonly container: HTMLElement;
  readonly unsubscribe: () => void;
}

/** 等待可被新意图中止；后台准备仍归缓存拥有，卸载时统一释放 */
function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** 缓存两个视图，只把完成交接的那个挂到上下文（ADR 0064） */
export class MapViewSwitch implements Disposable {
  readonly #state = shallowRef<MapViewSwitchState>({ current: null, target: '2d', status: 'loading' });
  readonly state = shallowReadonly(this.#state);
  readonly #map: MapContextState;
  readonly #containers: Readonly<Record<ViewKind, HTMLElement>>;
  readonly #load: LoadMapView;
  readonly #requests = new LatestController();
  readonly #cache = new Map<ViewKind, CachedView>();
  readonly #loading = new Map<ViewKind, Promise<CachedView>>();
  readonly #activation = new Set<() => void>();
  readonly #report: (error: unknown) => void;
  #current: CachedView | null = null;
  #active: boolean;
  #disposed = false;

  constructor(map: MapContextState, containers: Readonly<Record<ViewKind, HTMLElement>>, load: LoadMapView, active = true) {
    this.#map = map;
    this.#containers = containers;
    this.#load = load;
    this.#active = active;
    this.#report = safeReporter(map.onError, 'MapViewSwitch');
  }

  /** 最后的目标生效；返回当前视图也会作废尚未完成的切换 */
  async switchTo(target: ViewKind): Promise<void> {
    if (this.#disposed) {
      return;
    }
    const signal = this.#requests.next();
    if (signal.aborted) {
      return;
    }
    if (this.#current?.view.kind === target && this.#current.view.state !== 'failed') {
      this.#publish(target, 'ready');
      return;
    }
    this.#publish(target, 'loading');
    try {
      const candidate = await waitFor(this.#prepare(target), signal);
      while (!signal.aborted) {
        if (!this.#active) {
          // oxlint-disable-next-line no-await-in-loop -- 页面恢复后才能交接，每轮都须重新检查当前意图
          await this.#whenActive(signal);
          if (signal.aborted) {
            return;
          }
          if (!this.#active) {
            continue;
          }
        }
        if (this.#handover(candidate, signal)) {
          // attachView 会同步执行排队定位，回调可能开始另一轮切换
          if (!signal.aborted) {
            this.#publish(target, 'ready');
          }
          return;
        }
        // 恢复二维可能因追赶样式开始新一轮加载；原图已恢复，等这一轮结束再交接
        // oxlint-disable-next-line no-await-in-loop -- 下一轮依赖本轮样式加载，不能并行恢复同一视图
        await waitFor(candidate.view.whenReady(), signal);
      }
    } catch (error) {
      if (!signal.aborted) {
        this.#publish(target, 'failed', error);
      }
    }
  }

  /** 失败的候选被重新创建；健康的缓存不重复加载 */
  retry(): Promise<void> {
    return this.switchTo(this.#state.value.target);
  }

  /** 页面暂停期间只准备，恢复后再验证目标能否激活并交接 */
  setActive(active: boolean): void {
    if (this.#disposed || this.#active === active) {
      return;
    }
    this.#active = active;
    try {
      if (active) {
        this.#current?.view.resume();
      } else {
        this.#current?.view.pause();
      }
    } catch (error) {
      // 生命周期调用抛错后无法保证实例可用，释放后重试，不能复用仍标着 paused 的坏实例
      if (this.#current) {
        this.#release(this.#current);
      }
      this.#publish(this.#state.value.target, 'failed', error);
    } finally {
      if (active) {
        for (const notify of this.#activation) {
          notify();
        }
      }
    }
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#requests[Symbol.dispose]();
    for (const entry of this.#cache.values()) {
      this.#release(entry);
    }
  }

  #publish(target: ViewKind, status: MapViewSwitchState['status'], error?: unknown): void {
    this.#state.value = { current: this.#current?.view.kind ?? null, target, status, error };
  }

  #whenActive(signal: AbortSignal): Promise<void> {
    let notify!: () => void;
    const activated = new Promise<void>(resolve => { notify = resolve; });
    this.#activation.add(notify);
    return waitFor(activated, signal).finally(() => this.#activation.delete(notify));
  }

  #prepare(kind: ViewKind): Promise<CachedView> {
    const loading = this.#loading.get(kind);
    if (loading) {
      return loading;
    }
    const cached = this.#cache.get(kind);
    if (cached && cached.view.state !== 'failed') {
      return cached.view.whenReady().then(() => cached);
    }
    if (cached) {
      this.#release(cached);
    }
    const preparing = this.#create(kind);
    this.#loading.set(kind, preparing);
    // 两条结束路径都清掉槽位，失败后允许重试
    void preparing.then(() => this.#loading.delete(kind), () => this.#loading.delete(kind));
    return preparing;
  }

  async #create(kind: ViewKind): Promise<CachedView> {
    const create = await this.#load(kind);
    if (this.#disposed) {
      throw new DOMException('地图切换已释放', 'AbortError');
    }
    const container = this.#containers[kind];
    const view = create(container);
    const entry: CachedView = {
      view,
      container,
      unsubscribe: view.on('statechange', state => {
        if (this.#current?.view === view && state === 'failed' && this.#state.value.status !== 'loading') {
          this.#publish(kind, 'failed', view.failure?.error);
        }
      })
    };
    this.#cache.set(kind, entry);
    try {
      await view.whenReady();
      if (this.#disposed) {
        throw new DOMException('地图切换已释放', 'AbortError');
      }
      return entry;
    } catch (error) {
      this.#release(entry);
      throw error;
    }
  }

  // 同步交接不允许两个视图同时接收输入；失败或需要重新加载时立刻还原原图
  #handover(candidate: CachedView, signal: AbortSignal): boolean {
    const previous = this.#current;
    const { view } = candidate;
    try {
      previous?.view.pause();
      if (previous) {
        this.#map.detachView(previous.view);
      }
      this.#current = null;
      if (signal.aborted) {
        throw abortReason(signal);
      }
      if (this.#active) {
        view.resume();
      }
      if (signal.aborted) {
        throw abortReason(signal);
      }
      if (view.state === 'failed' || view.state === 'disposed') {
        throw new Error('候选视图已不可用', { cause: view.failure?.error });
      }
      if (!this.#active || view.state !== 'ready') {
        this.#restore(previous, candidate);
        return false;
      }
      this.#current = candidate;
      this.#map.attachView(view, candidate.container);
      return true;
    } catch (error) {
      if (!this.#disposed) {
        this.#restore(previous, candidate);
      }
      // 仅意图被替换时保留健康缓存：新请求可能正在复用同一候选
      if (!signal.aborted || error !== abortReason(signal)) {
        this.#release(candidate);
      }
      throw error;
    }
  }

  #restore(previous: CachedView | null, candidate: CachedView): void {
    const steps = [() => this.#map.detachView(candidate.view), () => {
      try {
        candidate.view.pause();
      } catch (error) {
        // 不能暂停的候选先释放，再恢复原图，避免两个引擎同时接收输入
        this.#release(candidate);
        throw error;
      }
    }];
    // 暂停旧视图本身也可能抛错，先确保旧连接卸下，再逐步还原
    if (previous) {
      steps.push(() => this.#map.detachView(previous.view));
    }
    this.#current = previous;
    if (previous) {
      if (this.#active) {
        steps.push(() => previous.view.resume());
      }
      steps.push(() => this.#map.attachView(previous.view, previous.container));
    }
    for (const step of steps) {
      try {
        step();
      } catch (error) {
        this.#report(error);
      }
    }
  }

  #release(entry: CachedView): void {
    if (this.#cache.get(entry.view.kind) !== entry) {
      return;
    }
    this.#cache.delete(entry.view.kind);
    if (this.#current === entry) {
      this.#current = null;
    }
    for (const step of [entry.unsubscribe, () => this.#map.detachView(entry.view), () => entry.view[Symbol.dispose]()]) {
      try {
        step();
      } catch (error) {
        this.#report(error);
      }
    }
  }
}
