import { safeReporter } from '@yzt/utils';
import { getCurrentScope, onScopeDispose, watch } from 'vue';
import { useSessionStore } from '../auth/session-store';
import { preferenceStore } from './idb-store';
import type { KeyValueStore } from './key-value-store';

/** 偏好的范围（ADR 0042 第 2 节）：页面装配时创建，交给要持久化的拥有者 */
export interface PreferenceScope {
  readonly store: KeyValueStore;
  /** 键是创建时固定的登录名加名称，之后不再读会话 */
  readonly key: (name: string) => string;
  /** 生命期：页面的作用域销毁、会话里的用户不再是创建时的那个时中止 */
  readonly signal: AbortSignal;
  /** 读写失败的上报，不弹提示 */
  readonly onError: (error: unknown) => void;
}

export interface PreferenceScopeOptions {
  /** 默认是整个应用共用的 IndexedDB 存储；测试时换成内存实现 */
  readonly store?: KeyValueStore;
  /** 默认打印到控制台 */
  readonly onError?: (error: unknown) => void;
}

function reportToConsole(error: unknown): void {
  console.error('[storage]', error);
}

/** 在页面的 setup 中按当前会话创建偏好的范围；没有登录时为 null，拥有者就不读不写 */
export function usePreferenceScope(options: PreferenceScopeOptions = {}): PreferenceScope | null {
  if (!getCurrentScope()) {
    throw new Error('usePreferenceScope 只能在组件的 setup 或 effectScope 中调用');
  }
  const session = useSessionStore();
  const loginName = session.user?.loginName;
  if (loginName === undefined) {
    return null;
  }
  const lifetime = new AbortController();
  const end = () => lifetime.abort(new DOMException('偏好的范围已结束', 'AbortError'));
  // 同步侦听：endSession 清空会话时立即结束，排队的写入在跳转、卸载页面之前落到原用户的键
  watch(
    () => session.user?.loginName,
    current => {
      if (current !== loginName) {
        end();
      }
    },
    { flush: 'sync' }
  );
  onScopeDispose(end);
  const prefix = `${encodeURIComponent(loginName)}/`;
  return {
    store: options.store ?? preferenceStore,
    key: name => `${prefix}${name}`,
    signal: lifetime.signal,
    onError: safeReporter(options.onError ?? reportToConsole, 'storage')
  };
}
