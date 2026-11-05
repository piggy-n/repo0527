// 只供测试使用

import { createMemoryStore, type KeyValueStore } from './key-value-store';
import type { PreferenceScope } from './preference-scope';

/** 测试用的偏好范围：内存存储、固定的用户；end 结束生命期，errors 记下上报的错误 */
export function createTestPreferenceScope(store: KeyValueStore = createMemoryStore(), loginName = 'zhangsan') {
  const lifetime = new AbortController();
  const errors: unknown[] = [];
  const scope: PreferenceScope = {
    store,
    key: name => `${loginName}/${name}`,
    signal: lifetime.signal,
    onError: error => errors.push(error)
  };
  return { scope, errors, end: () => lifetime.abort() };
}
