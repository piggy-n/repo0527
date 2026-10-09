import type { StyleGroup, StyleModel } from '@yzt/map-core';
import { computed, type ComputedRef, watch, type WatchHandle } from 'vue';

/** 拥有者给出的推导函数：从自己的状态推导出整个分组（ADR 0028） */
export type StyleDerivation = () => StyleGroup;

// 推导的结果：失败也是一个值，缓存到推导用到的依赖变化为止
type Derived = { readonly ok: true; readonly group: StyleGroup } | { readonly ok: false; readonly error: unknown };

interface Binding<G extends string> {
  readonly id: G;
  readonly derived: ComputedRef<Derived>;
}

/**
 * 把各拥有者的推导结果一次提交给样式模型（ADR 0028 第 2 条）：同一轮变化的分组用一次 setGroups 提交；
 * 任一推导失败或校验不通过时整批跳过，之后的变化连同没提交成功的分组一起重新提交
 */
export class StyleBinder<G extends string> implements Disposable {
  readonly #style: StyleModel<G>;
  readonly #onError: (error: unknown) => void;
  readonly #bindings = new Map<G, Binding<G>>();
  // 每个分组上次提交成功的分组对象，没提交成功的分组下次照样算作变化
  readonly #committed = new Map<G, StyleGroup>();
  // 推导失败的结果对象在依赖变化前保持不变，用它去重，同一个失败只报告一次
  readonly #reported = new WeakSet<object>();
  #state: 'binding' | 'running' | 'disposed' = 'binding';
  #watcher: WatchHandle | undefined;

  constructor(style: StyleModel<G>, onError: (error: unknown) => void) {
    this.#style = style;
    this.#onError = onError;
  }

  /** 登记推导函数；只能在 start 之前调用，一个分组只能绑定一次 */
  bind(bindings: Partial<Readonly<Record<G, StyleDerivation>>>): void {
    if (this.#state !== 'binding') {
      throw new Error('样式只能在 provideMap 所在组件的 setup 中绑定');
    }
    const entries = Object.entries<StyleDerivation | undefined>(bindings) as [G, StyleDerivation | undefined][];
    // 先全部检查再登记：重复时这一次的绑定都不生效
    for (const [id] of entries) {
      if (this.#bindings.has(id)) {
        throw new Error(`分组 ${id} 已经绑定过`);
      }
    }
    for (const [id, derive] of entries) {
      if (derive) {
        this.#bindings.set(id, { id, derived: computed(() => deriveSafely(derive)) });
      }
    }
  }

  /** 关闭登记，把所有绑定的初始值一次提交，然后开始侦听 */
  start(): void {
    if (this.#state !== 'binding') {
      return;
    }
    this.#state = 'running';
    const bindings = [...this.#bindings.values()];
    // immediate：初始值同步提交；之后按默认的 pre 时机，同一轮的变化只执行一次
    this.#watcher = watch(
      () => bindings.map(binding => binding.derived.value),
      results => this.#commit(bindings, results),
      { immediate: true }
    );
  }

  /** 停止侦听和提交；不清空已提交的分组 */
  [Symbol.dispose](): void {
    this.#state = 'disposed';
    this.#watcher?.stop();
  }

  #commit(bindings: readonly Binding<G>[], results: readonly Derived[]): void {
    if (this.#state !== 'running') {
      return;
    }
    const changes: [G, StyleGroup][] = [];
    let failed = false;
    for (const [index, result] of results.entries()) {
      const { id } = bindings[index];
      if (!result.ok) {
        failed = true;
        this.#reportFailure(id, result);
      } else if (this.#committed.get(id) !== result.group) {
        changes.push([id, result.group]);
      }
    }
    if (failed || changes.length === 0) {
      return;
    }
    try {
      this.#style.setGroups(Object.fromEntries(changes) as Partial<Record<G, StyleGroup>>);
    } catch (error) {
      const ids = changes.map(([id]) => id).join('、');
      this.#onError(new Error(`分组 ${ids} 的样式没有通过校验，本轮不提交`, { cause: error }));
      return;
    }
    for (const [id, group] of changes) {
      this.#committed.set(id, group);
    }
  }

  #reportFailure(id: G, failure: Extract<Derived, { readonly ok: false }>): void {
    if (this.#reported.has(failure)) {
      return;
    }
    this.#reported.add(failure);
    this.#onError(new Error(`分组 ${id} 的推导函数出错，本轮样式不提交`, { cause: failure.error }));
  }
}

// 异常在这里变成值：computed 自己抛错时，读取方接不住，之后还会返回旧值（ADR 0028 背景第 8 条）
function deriveSafely(derive: StyleDerivation): Derived {
  try {
    return { ok: true, group: derive() };
  } catch (error) {
    return { ok: false, error };
  }
}
