import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from './roles';
import { type Session, useSessionStore, watchSessionStorage } from './session-store';
import { createTestJwtExpiringAt } from './testing';

const STORAGE_KEY = 'yzt.session';
const NOW = Date.UTC(2026, 8, 29, 12);

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    token: createTestJwtExpiringAt(NOW + 3_600_000),
    user: { id: '7', loginName: 'zhangsan', realName: '张三', role: Role.admin },
    ...overrides
  };
}

// 另一个标签页登录的会话
const otherSession = createSession({
  token: createTestJwtExpiringAt(NOW + 7_200_000),
  user: { loginName: 'lisi', role: Role.user }
});

// 新建一个 pinia 再取 store，相当于刷新页面后重新从 localStorage 读取
function useFreshStore() {
  setActivePinia(createPinia());
  return useSessionStore();
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSessionStore', () => {
  it('初始没有会话', () => {
    const store = useFreshStore();

    expect(store.session).toBeNull();
    expect(store.token).toBeUndefined();
    expect(store.displayName).toBe('');
    expect(store.isActive()).toBe(false);
  });

  it('start 保存会话，刷新页面后仍然有效', () => {
    const session = createSession();
    useFreshStore().start(session);

    const store = useFreshStore();

    expect(store.session).toEqual(session);
    expect(store.token).toBe(session.token);
    expect(store.user?.role).toBe(Role.admin);
    expect(store.isActive()).toBe(true);
  });

  it('clear 同时清空内存和 localStorage', () => {
    const store = useFreshStore();
    store.start(createSession());

    store.clear();

    expect(store.session).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useFreshStore().session).toBeNull();
  });

  it('其他标签页已换账号登录时，clear 只清空内存，不删除存储中的新会话', () => {
    const store = useFreshStore();
    store.start(createSession());
    // 另一个标签页写入存储，本标签页内存中的会话不变
    localStorage.setItem(STORAGE_KEY, JSON.stringify(otherSession));

    store.clear();

    expect(store.session).toBeNull();
    expect(useFreshStore().session).toEqual(otherSession);
  });

  it('本标签页未登录、其他标签页已登录时，clear 不删除存储中的会话', () => {
    const store = useFreshStore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(otherSession));

    store.clear();

    expect(useFreshStore().session).toEqual(otherSession);
  });

  it('syncFromStorage 读取其他标签页写入的会话', () => {
    const store = useFreshStore();
    store.start(createSession());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(otherSession));

    store.syncFromStorage();

    expect(store.session).toEqual(otherSession);
  });

  it('watchSessionStorage 只在会话的键变化或存储被清空时回调，取消后不再回调', () => {
    const onChange = vi.fn<() => void>();
    const stop = watchSessionStorage(onChange);

    window.dispatchEvent(new StorageEvent('storage', { key: 'other-key' }));
    expect(onChange).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(onChange).toHaveBeenCalledTimes(2);

    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('显示名优先用真实姓名，没有时用登录名', () => {
    const store = useFreshStore();

    store.start(createSession());
    expect(store.displayName).toBe('张三');

    store.start(createSession({ user: { loginName: 'lisi', realName: '', role: Role.user } }));
    expect(store.displayName).toBe('lisi');
  });

  it('token 过期后 isActive 为 false', () => {
    const store = useFreshStore();
    store.start(createSession({ token: createTestJwtExpiringAt(NOW + 120_000) }));
    expect(store.isActive()).toBe(true);

    vi.advanceTimersByTime(100_000);

    expect(store.isActive()).toBe(false);
  });

  it.each([
    ['不是 JSON', '{broken'],
    ['结构不符', JSON.stringify({ token: 'abc', user: { loginName: 'x', role: 'root' } })],
    ['token 为空', JSON.stringify({ ...createSession(), token: '' })]
  ])('保存的数据%s时视为未登录，并删除该数据', (_, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);

    const store = useFreshStore();

    expect(store.session).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
