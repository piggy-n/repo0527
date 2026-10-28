import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, type Ref, ref } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import type { Message } from '../api';
import {
  approvalMessage,
  createMessageBackend,
  type MessageBackendOptions,
  resourceMessage,
  tableMessage
} from '../test-data';
import { MESSAGE_BATCH, type MessageCenter, useMessageCenter } from './useMessageCenter';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let open: Ref<boolean>;
let center: MessageCenter;

let initiallyOpen = true;

const Host = defineComponent(() => {
  open = ref(initiallyOpen);
  center = useMessageCenter(open);
  return () => null;
});

function mountHost({ opened = true } = {}) {
  initiallyOpen = opened;
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
}

function mockServer(options: MessageBackendOptions = {}) {
  const backend = createMessageBackend(options);
  server.use(...backend.handlers);
  return backend;
}

// 2 条业务消息之后是 45 条报表通知，每 3 条有 2 条未读
const reports = Array.from({ length: 45 }, (_, index) =>
  tableMessage({ msgId: `msg-table-${index}`, isRead: index % 3 === 0 ? 'true' : 'false' })
);
const manyMessages = () => [approvalMessage(), resourceMessage(), ...structuredClone(reports)];

const ids = () => center.visible.value.map(message => message.id);
const find = (id: string): Message => required(center.visible.value.find(message => message.id === id), `消息 ${id}`);

// 应当立即返回的调用：和只经过一轮宏任务的等待赛跑，漏了判断时请求被挂起，断言失败而不是等到超时
const immediately = <T,>(promise: Promise<T>) =>
  Promise.race([promise, new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 0))]);

async function loaded() {
  await vi.waitFor(() => expect(center.visible.value.length).toBeGreaterThan(0));
}

describe('筛选与分批显示', () => {
  it('一次显示 20 条，滚到底再接着显示；换条件从头显示', async () => {
    mockServer({ messages: manyMessages() });
    mountHost();
    await loaded();
    expect(center.visible.value).toHaveLength(MESSAGE_BATCH);
    expect(center.filteredCount.value).toBe(47);

    center.loadMore();
    center.loadMore();
    expect(center.visible.value).toHaveLength(47);
    expect(center.hasMore.value).toBe(false);
    center.loadMore();
    expect(center.visible.value).toHaveLength(47);

    center.setCategory('table');
    expect(center.visible.value).toHaveLength(MESSAGE_BATCH);
    expect(center.filteredCount.value).toBe(45);

    center.loadMore();
    expect(center.visible.value).toHaveLength(MESSAGE_BATCH * 2);
    center.setReadFilter('unread');
    expect(center.filteredCount.value).toBe(30);
    expect(center.visible.value).toHaveLength(MESSAGE_BATCH);
    expect(center.visible.value.every(message => message.category === 'table' && !message.read)).toBe(true);

    center.setCategory('all');
    expect(ids().slice(0, 2)).toEqual(['msg-approval', 'msg-table-1']);
    expect(center.unreadCount.value).toBe(31);
  });

  it('第一次请求中、失败与重试；弹框关着时不取全部消息', async () => {
    const { lists, control, requests } = mockServer({ holdLists: true, failLists: true });
    mountHost({ opened: false });
    await vi.waitFor(() => expect(lists).toHaveLength(1));
    expect(requests).toEqual(['unread']);

    open.value = true;
    await vi.waitFor(() => expect(lists).toHaveLength(2));
    expect(center.initialLoading.value).toBe(true);
    expect(center.loadFailed.value).toBe(false);
    control.holdLists = false;
    for (const release of lists) {
      release();
    }
    await vi.waitFor(() => expect(center.loadFailed.value).toBe(true));
    expect(center.initialLoading.value).toBe(false);

    control.failLists = false;
    center.retry();
    await loaded();
    expect(center.loadFailed.value).toBe(false);
  });
});

describe('已读', () => {
  it('同一条防重复；已读的不再提交；成功后才变成已读', async () => {
    const { requests, reads } = mockServer({ holdRead: true });
    mountHost();
    await loaded();
    const message = find('msg-approval');

    const first = center.markRead(message);
    expect(await immediately(center.markRead(message))).toBe(false);
    expect(center.isReading('msg-approval')).toBe(true);
    expect(find('msg-approval').read).toBe(false);

    await vi.waitFor(() => expect(reads).toHaveLength(1));
    required(reads[0], '已读请求')();
    expect(await first).toBe(true);
    expect(center.isReading('msg-approval')).toBe(false);
    expect(find('msg-approval').read).toBe(true);

    expect(await immediately(center.markRead(find('msg-resource')))).toBe(false);
    expect(requests.filter(request => request.startsWith('read'))).toEqual(['read msg-approval']);
  });

  it('失败时返回 false、保留未读，可以再试', async () => {
    const { control } = mockServer({ failRead: true });
    mountHost();
    await loaded();

    expect(await center.markRead(find('msg-approval'))).toBe(false);
    expect(center.isReading('msg-approval')).toBe(false);
    expect(find('msg-approval').read).toBe(false);

    control.failRead = false;
    expect(await center.markRead(find('msg-approval'))).toBe(true);
  });

  it('发送期间换了会话或弹框已销毁：照常完成，但不报告成功', async () => {
    const { reads } = mockServer({ holdRead: true });
    const wrapper = mountHost();
    await loaded();

    const switched = center.markRead(find('msg-approval'));
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    useSessionStore().start({
      token: createTestJwtExpiringAt(Date.now() + 7200000),
      user: { loginName: 'other', role: Role.admin }
    });
    required(reads[0], '已读请求')();
    expect(await switched).toBe(false);

    const removed = center.markRead(find('msg-table'));
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    wrapper.unmount();
    required(reads[1], '已读请求')();
    expect(await removed).toBe(false);
  });
});

describe('全部已读', () => {
  it('和单条已读互斥：任一进行中时另一个不提交', async () => {
    const { requests, reads } = mockServer({ holdRead: true });
    mountHost();
    await loaded();
    expect(center.canReadAll.value).toBe(true);

    const single = center.markRead(find('msg-approval'));
    expect(center.canReadAll.value).toBe(false);
    expect(await immediately(center.markAllRead())).toBe(false);
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    required(reads[0], '已读请求')();
    await single;

    const all = center.markAllRead();
    expect(center.readingAll.value).toBe(true);
    expect(await immediately(center.markRead(find('msg-table')))).toBe(false);
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    required(reads[1], '全部已读请求')();
    expect(await all).toBe(true);
    expect(center.readingAll.value).toBe(false);
    expect(center.unreadCount.value).toBe(0);
    expect(center.canReadAll.value).toBe(false);
    expect(requests.filter(request => request.startsWith('read'))).toEqual(['read msg-approval', 'read all']);
  });

  it('没有看到未读时不提交', async () => {
    const { requests } = mockServer({ messages: [resourceMessage()] });
    mountHost();
    await loaded();
    expect(center.canReadAll.value).toBe(false);
    expect(await center.markAllRead()).toBe(false);
    expect(requests).not.toContain('read all');
  });
});
