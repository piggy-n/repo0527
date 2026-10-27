import type { SceneContent, SceneContentModel } from '@yzt/map-core';
import { computed, type ComputedRef, watch, type WatchHandle } from 'vue';

/** 拥有者给出的推导函数：从自己的状态推导出整份三维内容（ADR 0081 第 2 节） */
export type SceneDerivation = () => SceneContent;

// 推导的结果：失败也是一个值，缓存到推导用到的依赖变化为止（ADR 0028 背景第 8 条）
type Derived = { readonly ok: true; readonly content: SceneContent } | { readonly ok: false; readonly error: unknown };

function deriveSafely(derive: SceneDerivation): Derived {
  try {
    return { ok: true, content: derive() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * 把拥有者推导的三维内容提交给会话（ADR 0081 第 2 节）：一个上下文只绑定一个推导函数；
 * 推导失败、内容不合法时报告错误，这一轮不提交
 */
export class SceneBinder implements Disposable {
  readonly #scene: SceneContentModel;
  readonly #onError: (error: unknown) => void;
  #derived: ComputedRef<Derived> | undefined;
  #state: 'binding' | 'running' | 'disposed' = 'binding';
  #watcher: WatchHandle | undefined;
  // 推导失败的结果对象在依赖变化前保持不变，同一个失败只报告一次
  readonly #reported = new WeakSet<object>();

  constructor(scene: SceneContentModel, onError: (error: unknown) => void) {
    this.#scene = scene;
    this.#onError = onError;
  }

  /** 登记推导函数；只能在 start 之前调用一次 */
  bind(derive: SceneDerivation): void {
    if (this.#state !== 'binding') {
      throw new Error('三维内容只能在 provideMap 所在组件的 setup 中绑定');
    }
    if (this.#derived) {
      throw new Error('三维内容已经绑定过');
    }
    this.#derived = computed(() => deriveSafely(derive));
  }

  /** 关闭登记，提交初始值，然后开始侦听；没有绑定时什么也不做 */
  start(): void {
    if (this.#state !== 'binding') {
      return;
    }
    this.#state = 'running';
    const derived = this.#derived;
    if (derived) {
      this.#watcher = watch(derived, result => this.#commit(result), { immediate: true });
    }
  }

  /** 停止侦听和提交；不清空已提交的内容 */
  [Symbol.dispose](): void {
    this.#state = 'disposed';
    this.#watcher?.stop();
  }

  #commit(result: Derived): void {
    if (this.#state !== 'running') {
      return;
    }
    if (!result.ok) {
      if (!this.#reported.has(result)) {
        this.#reported.add(result);
        this.#onError(new Error('三维内容的推导函数出错，本轮不提交', { cause: result.error }));
      }
      return;
    }
    try {
      this.#scene.set(result.content);
    } catch (error) {
      this.#onError(new Error('三维内容没有通过校验，本轮不提交', { cause: error }));
    }
  }
}
