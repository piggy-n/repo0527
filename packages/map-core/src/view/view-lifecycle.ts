import type { MapViewFailure, ViewState } from './map-view';

// 二维、三维视图共用的生命周期辅助（ADR 0022 第 5 条、ADR 0026、0030、0079）

/** 一轮加载的结果：外面能看到是否已经有结果 */
export interface Deferred {
  readonly promise: Promise<void>;
  readonly settled: boolean;
  resolve(): void;
  reject(reason: unknown): void;
}

export function deferred(): Deferred {
  let settled = false;
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // 没人等待时被拒绝也不报"未处理的拒绝"，等待的人照样收到错误
  void promise.catch(() => undefined);
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve() {
      settled = true;
      resolve();
    },
    reject(reason) {
      settled = true;
      reject(reason);
    }
  };
}

/** 释放之前的状态；释放不经过转换表，任何状态都可以释放 */
export type LiveViewState = Exclude<ViewState, 'disposed'>;

// 允许的状态转换（ADR 0026、0030，见 map-core.md"状态转换"）：样式失败后报错的加载仍可能完成，所以 failed 能直接到 ready、paused；
// failed → failed 是失败原因的更新（样式失败换成新的原因，或升级为引擎失败）。引擎失败之后只能释放
const TRANSITIONS: Readonly<Record<LiveViewState, readonly LiveViewState[]>> = {
  initializing: ['ready', 'paused', 'failed'],
  ready: ['paused', 'failed'],
  paused: ['ready', 'failed'],
  failed: ['initializing', 'ready', 'paused', 'failed']
};

/** 视图能不能从 from 转换到 to：已释放、引擎失败之后都不能 */
export function canTransition(from: ViewState, failure: MapViewFailure | null, to: LiveViewState): boolean {
  return from !== 'disposed' && failure?.kind !== 'engine' && TRANSITIONS[from].includes(to);
}
