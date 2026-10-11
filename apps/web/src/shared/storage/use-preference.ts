import { getCurrentScope, onScopeDispose, watch } from 'vue';
import { z } from 'zod';
import type { PreferenceScope } from './preference-scope';

/** 读取最多等这么久，超时按默认值继续（ADR 0042 第 5 节） */
export const PREFERENCE_READ_TIMEOUT = 1000;

/** 状态变化后防抖这么久再写入（ADR 0042 第 6 节） */
export const PREFERENCE_WRITE_DEBOUNCE = 300;

/** 拥有者给出的部分（ADR 0042 第 4 节）：名称、版本、schema、转换与合并 */
export interface PreferenceOptions<T> {
  /** 键的后半段，如 resource-layers */
  readonly name: string;
  /** 存储格式的版本：格式变化时加 1，其他版本的数据当作没有存过 */
  readonly version: number;
  /** 存下的值的 schema，包括自洽的检查（ADR 0042 第 3 节） */
  readonly schema: z.ZodType<T>;
  /** 当前状态的存储格式（普通数据）；被侦听，变化后写入 */
  readonly snapshot: () => T;
  /**
   * 恢复结束时调用一次：校验过的值，或 null（没有存过、读取失败、超时、格式不对、恢复之前已经操作过）。
   * 拥有者按自己的规则把它合并进当前状态，不直接使用
   */
  readonly restore: (stored: T | null) => void;
}

/**
 * 一项偏好的恢复与写入（ADR 0042 第 4～6 节），在拥有者创建时（setup 或 effectScope 中）调用：
 * 开始读取并等待上限，恢复只应用一次；恢复之后防抖写入；生命期结束、作用域销毁时写入还没写的那一次，
 * 页面隐藏时尽力提交；生命期结束后不再写入，还没到的读取结果不再应用
 */
export function usePreference<T>(scope: PreferenceScope, options: PreferenceOptions<T>): void {
  if (!getCurrentScope()) {
    throw new Error('usePreference 只能在组件的 setup 或 effectScope 中调用');
  }
  const { name, version, schema, snapshot, restore } = options;
  const { store, signal, onError } = scope;
  if (signal.aborted) {
    return;
  }
  const key = scope.key(name);
  const record = z.object({ version: z.literal(version), value: schema });

  let settled = false;
  let restoring = false;
  // 恢复之前状态就变了：用户已经操作过，放弃恢复
  let touched = false;
  let ended = false;
  let pending: { readonly value: T } | null = null;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;

  const write = () => {
    clearTimeout(writeTimer);
    if (!pending) {
      return;
    }
    const { value } = pending;
    pending = null;
    store.set(key, { version, value }).catch(onError);
  };

  const schedule = (value: T) => {
    pending = { value };
    clearTimeout(writeTimer);
    writeTimer = setTimeout(write, PREFERENCE_WRITE_DEBOUNCE);
  };

  // 同步侦听：拖动滑块时每次变化都重新计时，只写最后一次；恢复本身引起的变化不写回去
  const stopWatch = watch(
    snapshot,
    value => {
      if (!settled) {
        touched = true;
      } else if (!restoring) {
        schedule(value);
      }
    },
    { flush: 'sync' }
  );

  const settle = (stored: T | null) => {
    if (settled || ended) {
      return;
    }
    settled = true;
    clearTimeout(readTimer);
    restoring = true;
    try {
      restore(touched ? null : stored);
    } finally {
      restoring = false;
    }
    // 恢复之前的操作也要保存下来
    if (touched) {
      schedule(snapshot());
    }
  };

  const readTimer = setTimeout(() => settle(null), PREFERENCE_READ_TIMEOUT);
  // 只有读取本身的失败按读取失败处理；拥有者的 restore 抛错不算
  const read = async (): Promise<T | null> => {
    try {
      const parsed = record.safeParse(await store.get(key));
      return parsed.success ? parsed.data.value : null;
    } catch (error) {
      onError(error);
      return null;
    }
  };
  void read().then(settle).catch(onError);

  // 刷新、关闭标签页不走 Vue 的卸载流程：页面隐藏时尽力提交，浏览器退出前不保证写完（ADR 0042 第 6 节）
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      write();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', write);

  const end = () => {
    if (ended) {
      return;
    }
    // 先写入还没写的那一次（落到创建时固定的键），再停止
    write();
    ended = true;
    clearTimeout(readTimer);
    stopWatch();
    signal.removeEventListener('abort', end);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', write);
  };
  signal.addEventListener('abort', end);
  onScopeDispose(end);
}
