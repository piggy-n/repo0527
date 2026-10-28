import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import {
  UNREAD_REFRESH_INTERVAL,
  useMarkAllReadMutation,
  useMarkReadMutation,
  useMessagesQuery,
  useUnreadCountQuery
} from './queries';
import { createMessageBackend, type MessageBackendOptions } from './test-data';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

let open: ReturnType<typeof ref<boolean>>;
let list: ReturnType<typeof useMessagesQuery>;
let unread: ReturnType<typeof useUnreadCountQuery>;
let markRead: ReturnType<typeof useMarkReadMutation>;
let markAll: ReturnType<typeof useMarkAllReadMutation>;
let queryClient: QueryClient;

const Host = defineComponent(() => {
  open = ref(false);
  list = useMessagesQuery(() => open.value === true);
  unread = useUnreadCountQuery();
  markRead = useMarkReadMutation();
  markAll = useMarkAllReadMutation();
  return () => null;
});

function mountHost() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
}

const newSession = () => ({
  token: createTestJwtExpiringAt(Date.now() + 7200000),
  user: { loginName: 'other', role: Role.admin }
});

function mockServer(options: MessageBackendOptions = {}) {
  const backend = createMessageBackend(options);
  server.use(...backend.handlers);
  return backend;
}

const readIds = () => (list.data.value ?? []).filter(message => message.read).map(message => message.id);

describe('全部消息与未读数', () => {
  it('进入时只取未读数；弹框每次打开都取一次全量，先显示缓存', async () => {
    const { requests } = mockServer();
    mountHost();
    await vi.waitFor(() => expect(unread.data.value).toBe(2));
    expect(requests).toEqual(['unread']);

    open.value = true;
    await vi.waitFor(() => expect(list.data.value).toHaveLength(3));
    open.value = false;
    await vi.waitFor(() => expect(list.isFetching.value).toBe(false));

    open.value = true;
    expect(list.data.value).toHaveLength(3);
    await vi.waitFor(() => expect(requests).toEqual(['unread', 'list', 'list']));
  });

  it('全量列表到达时更新未读数，和弹框里的未读一致', async () => {
    const { arrive } = mockServer();
    mountHost();
    await vi.waitFor(() => expect(unread.data.value).toBe(2));

    arrive();
    open.value = true;
    await vi.waitFor(() => expect(list.data.value).toHaveLength(4));
    expect(unread.data.value).toBe(3);
  });

  it('标签页可见时每 60 秒刷新未读数，隐藏时不取', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { requests, arrive } = mockServer();
    mountHost();
    await vi.waitFor(() => expect(unread.data.value).toBe(2));

    arrive();
    vi.advanceTimersByTime(UNREAD_REFRESH_INTERVAL);
    await vi.waitFor(() => expect(unread.data.value).toBe(3));

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.advanceTimersByTime(UNREAD_REFRESH_INTERVAL * 2);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(requests).toEqual(['unread', 'unread']);
  });
});

describe('已读', () => {
  it('成功后马上改两个缓存，再按服务端刷新两个查询', async () => {
    const { requests, lists, control } = mockServer();
    mountHost();
    open.value = true;
    await vi.waitFor(() => expect(list.data.value).toHaveLength(3));
    await vi.waitFor(() => expect(unread.data.value).toBe(2));

    // 刷新挂起：断言的是本地先改的缓存，不是刷新回来的结果
    control.holdLists = true;
    await markRead.mutateAsync({ id: 'msg-approval', token: useSessionStore().token });
    expect(readIds()).toEqual(['msg-approval', 'msg-resource']);
    expect(unread.data.value).toBe(1);
    await vi.waitFor(() => expect(lists).toHaveLength(2));
    expect(requests.slice(-3).toSorted()).toEqual(['list', 'read msg-approval', 'unread']);
  });

  it('失败时不改缓存', async () => {
    mockServer({ failRead: true });
    mountHost();
    open.value = true;
    await vi.waitFor(() => expect(list.data.value).toHaveLength(3));

    await expect(markRead.mutateAsync({ id: 'msg-approval', token: useSessionStore().token })).rejects.toMatchObject({
      kind: 'business'
    });
    expect(readIds()).toEqual(['msg-resource']);
    expect(unread.data.value).toBe(2);
  });

  // 已读接口不挂起：漏了核对时请求会成功返回，断言失败而不是等到超时
  it('提交后、发请求前换了会话：不发送，以取消结束', async () => {
    const { requests } = mockServer();
    mountHost();
    await vi.waitFor(() => expect(unread.data.value).toBe(2));
    const session = useSessionStore();
    const done = markRead.mutateAsync({ id: 'msg-approval', token: session.token });
    session.start(newSession());
    await expect(done).rejects.toMatchObject({ kind: 'canceled' });
    expect(requests).toEqual(['unread']);
  });

  it('发送期间换了会话：照常完成，但不改新会话的缓存', async () => {
    const { requests, reads } = mockServer({ holdRead: true });
    mountHost();
    await vi.waitFor(() => expect(unread.data.value).toBe(2));
    const session = useSessionStore();
    const done = markRead.mutateAsync({ id: 'msg-approval', token: session.token });
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    session.start(newSession());

    reads[0]?.();
    await done;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(unread.data.value).toBe(2);
    expect(requests).toEqual(['unread', 'read msg-approval']);
  });
});

describe('全部已读', () => {
  it('本地只改提交时看到的未读，刷新后按服务端的结果显示', async () => {
    const { lists, control, arrive } = mockServer();
    mountHost();
    open.value = true;
    await vi.waitFor(() => expect(list.data.value).toHaveLength(3));

    arrive();
    control.holdLists = true;
    // 报表通知当作提交之后才显示出来的：本地不改它
    await markAll.mutateAsync({ ids: ['msg-approval'], token: useSessionStore().token });
    expect(readIds()).toEqual(['msg-approval', 'msg-resource']);
    expect(unread.data.value).toBe(1);

    // 后端把之后到达的新消息也改成了已读
    await vi.waitFor(() => expect(lists).toHaveLength(2));
    control.holdLists = false;
    for (const release of lists) {
      release();
    }
    await vi.waitFor(() => expect(list.data.value).toHaveLength(4));
    expect(readIds()).toEqual(['msg-new', 'msg-approval', 'msg-resource', 'msg-table']);
  });

  it('提交后、发请求前换了会话：不发送，以取消结束', async () => {
    const { requests } = mockServer();
    mountHost();
    await vi.waitFor(() => expect(unread.data.value).toBe(2));
    const session = useSessionStore();
    const done = markAll.mutateAsync({ ids: ['msg-approval'], token: session.token });
    session.start(newSession());
    await expect(done).rejects.toMatchObject({ kind: 'canceled' });
    expect(requests).toEqual(['unread']);
  });
});
