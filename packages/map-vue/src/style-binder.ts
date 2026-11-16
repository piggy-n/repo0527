import type { StyleGroup, StyleModel } from '@mx/map-core';
import { computed, type ComputedRef, watch, type WatchHandle } from 'vue';

/** 拥有者给出的推导函数：从自己的状态推导出整个分组（ADR 0028） */
export type StyleDerivation = () => StyleGroup;

/** 三维模型层插槽的推导函数（ADR 0161）：模型层插在哪个图层下面，undefined 是按 sceneBelow 放 */
export type SceneSlotDerivation = () => string | undefined;

// 推导的结果：失败也是一个值，缓存到推导用到的依赖变化为止
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
type Derived = Result<StyleGroup>;
type Failure = Extract<Result<unknown>, { readonly ok: false }>;

interface Binding<G extends string> {
  readonly id: G;
  readonly derived: ComputedRef<Derived>;
}

/**
 * 把各拥有者的推导结果一次提交给样式模型（ADR 0028 第 2 条）：同一轮变化的分组用一次 setGroups 提交，三维模型层的插槽
 * 紧跟着提交（ADR 0161），同一轮的通知只有一次；任一推导失败或校验不通过时整批跳过，之后的变化连同没提交成功的一起重新提交
 */
export class StyleBinder<G extends string> implements Disposable {
  readonly #style: StyleModel<G>;
  readonly #onError: (error: unknown) => void;
  readonly #bindings = new Map<G, Binding<G>>();
  // 每个分组上次提交成功的分组对象，没提交成功的分组下次照样算作变化
  readonly #committed = new Map<G, StyleGroup>();
  #slot: ComputedRef<Result<string | undefined>> | undefined;
  #committedSlot: string | undefined;
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

  /** 登记三维模型层插槽的推导函数（ADR 0161）；只能在 start 之前调用一次 */
  bindSlot(derive: SceneSlotDerivation): void {
    if (this.#state !== 'binding') {
      throw new Error('样式只能在 provideMap 所在组件的 setup 中绑定');
    }
    if (this.#slot) {
      throw new Error('三维模型层的插槽已经绑定过');
    }
    this.#slot = computed(() => deriveSafely(derive));
  }

  /** 关闭登记，把所有绑定的初始值一次提交，然后开始侦听 */
  start(): void {
    if (this.#state !== 'binding') {
      return;
    }
    this.#state = 'running';
    const bindings = [...this.#bindings.values()];
    const slot = this.#slot;
    // immediate：初始值同步提交；之后按默认的 pre 时机，同一轮的变化只执行一次
    this.#watcher = watch(
      () => [bindings.map(binding => binding.derived.value), slot?.value] as const,
      ([results, slotResult]) => this.#commit(bindings, results, slotResult),
      { immediate: true }
    );
  }

  /** 停止侦听和提交；不清空已提交的分组 */
  [Symbol.dispose](): void {
    this.#state = 'disposed';
    this.#watcher?.stop();
  }

  #commit(
    bindings: readonly Binding<G>[],
    results: readonly Derived[],
    slotResult: Result<string | undefined> | undefined
  ): void {
    if (this.#state !== 'running') {
      return;
    }
    const changes: [G, StyleGroup][] = [];
    let failed = false;
    for (const [index, result] of results.entries()) {
      const { id } = bindings[index];
      if (!result.ok) {
        failed = true;
        this.#reportFailure(`分组 ${id} 的推导函数出错，本轮样式不提交`, result);
      } else if (this.#committed.get(id) !== result.value) {
        changes.push([id, result.value]);
      }
    }
    if (slotResult && !slotResult.ok) {
      failed = true;
      this.#reportFailure('三维模型层的插槽推导出错，本轮样式不提交', slotResult);
    }
    if (failed) {
      return;
    }
    if (changes.length > 0) {
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
    // 分组提交成功以后再提交插槽：插槽指向这一轮新加的图层也照样生效，通知仍是一次
    if (slotResult?.ok === true && slotResult.value !== this.#committedSlot) {
      this.#style.setSceneSlot(slotResult.value);
      this.#committedSlot = slotResult.value;
    }
  }

  #reportFailure(message: string, failure: Failure): void {
    if (this.#reported.has(failure)) {
      return;
    }
    this.#reported.add(failure);
    this.#onError(new Error(message, { cause: failure.error }));
  }
}

// 异常在这里变成值：computed 自己抛错时，读取方接不住，之后还会返回旧值（ADR 0028 背景第 8 条）
function deriveSafely<T>(derive: () => T): Result<T> {
  try {
    return { ok: true, value: derive() };
  } catch (error) {
    return { ok: false, error };
  }
}
