import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import type { Message } from '../api';
import { messageFixture } from '../testing';
import { useMessageCenter } from './useMessageCenter';

const server = setupServer();
const cleanups: (() => void)[] = [];
const success = (data: unknown) => HttpResponse.json({ code: 200, data });
const rows = Array.from({ length: 24 }, (_, index) => ({
  ...messageFixture,
  msgId: String(index),
  isRead: index < 4 ? 'false' : 'true',
  category: index % 2 === 0 ? 'resource' : 'table'
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  server.resetHandlers();
  localStorage.clear();
});

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const list = vi.fn<() => Response>(() => success(rows));
  server.use(mock.post('/backend/api/message/list', list));
  let model!: ReturnType<typeof useMessageCenter>;
  const wrapper = mount(defineComponent({
    setup() {
      model = useMessageCenter();
      return () => null;
    }
  }), { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } });
  cleanups.push(() => {
    wrapper.unmount();
    client.clear();
  });
  await vi.waitFor(() => expect(model.messages.value).toHaveLength(24));
  model.open.value = true;
  await nextTick();
  await vi.waitFor(() => expect(model.refreshing.value).toBe(false));
  return { model, client, session, list, wrapper };
}

function holdWrite() {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => {
    release = resolve;
  });
  cleanups.push(release);
  const handler = vi.fn<() => Promise<Response>>(async () => {
    await waiting;
    return success(null);
  });
  server.use(mock.post('/backend/api/message/read/:id', handler));
  return { handler, release };
}

describe('消息拥有者', () => {
  it('筛选与分批展示使用同一查询数据，打开刷新但关闭不轮询', async () => {
    const { model, list } = await setup();
    expect(model.unreadCount.value).toBe(4);
    expect(model.visible.value).toHaveLength(20);
    model.limit.value += 20;
    expect(model.visible.value).toHaveLength(24);
    model.readFilter.value = 'unread';
    model.category.value = 'table';
    await nextTick();
    expect(model.limit.value).toBe(20);
    expect(model.visible.value.map(message => message.msgId)).toEqual(['1', '3']);
    const calls = list.mock.calls.length;
    model.open.value = false;
    await nextTick();
    expect(list).toHaveBeenCalledTimes(calls);
    model.open.value = true;
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(calls + 1));
  });

  it('单条写入成功才去红点，同一条防重复，并阻止全部已读重叠提交', async () => {
    const { model } = await setup();
    const held = holdWrite();
    model.select('0');
    model.select('0');
    await model.readAll();
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledTimes(1));
    expect(model.selected.value?.isRead).toBe(false);
    expect(model.unreadCount.value).toBe(4);
    held.release();
    await vi.waitFor(() => expect(model.selected.value?.isRead).toBe(true));
    expect(model.unreadCount.value).toBe(3);
  });

  it('单条失败保留未读与详情，重试成功后清除错误', async () => {
    const { model } = await setup();
    server.use(mock.post('/backend/api/message/read/:id', () => HttpResponse.json({ code: 500 })));
    model.select('0');
    await vi.waitFor(() => expect(model.selectedError.value).toBe('标记已读失败，请重试'));
    expect(model.selected.value?.isRead).toBe(false);
    server.use(mock.post('/backend/api/message/read/:id', () => success(null)));
    await model.read('0');
    expect(model.selectedError.value).toBe('');
    expect(model.selected.value?.isRead).toBe(true);
  });

  it('全部已读失败不清空红点，重试成功同步未读筛选及数量', async () => {
    const { model } = await setup();
    model.readFilter.value = 'unread';
    server.use(mock.post('/backend/api/message/read/all', () => HttpResponse.json({ code: 500 })));
    await model.readAll();
    expect(model.allError.value).toBe('全部标记已读失败，请重试');
    expect(model.unreadCount.value).toBe(4);
    const held = holdWrite();
    const writing = model.readAll();
    await model.readAll();
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledTimes(1));
    held.release();
    await writing;
    expect(model.unreadCount.value).toBe(0);
    expect(model.filtered.value).toEqual([]);
    expect(model.canReadAll.value).toBe(false);
  });

  it('调度前会话变化，不发送旧写操作，也不保留旧详情', async () => {
    const { model, session } = await setup();
    const held = holdWrite();
    const writing = model.read('0');
    session.clear();
    expect(await Promise.race([
      writing.then(() => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), 0))
    ])).toBe('settled');
    expect(held.handler).not.toHaveBeenCalled();
    expect(model.messages.value).toEqual([]);
    expect(model.open.value).toBe(false);
    expect(model.selected.value).toBeUndefined();
  });

  it('已发出的写操作在退出后返回，不覆盖缓存或报告成功', async () => {
    const { model, session, client } = await setup();
    const held = holdWrite();
    const writing = model.read('0');
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledTimes(1));
    session.clear();
    client.clear();
    held.release();
    await writing;
    expect(client.getQueryCache().findAll({ queryKey: ['message-center', 'list', 'admin'] })).toEqual([]);
    expect(model.selectedError.value).toBe('');
  });

  it('写成功取消正在读取的旧列表，迟到结果不能恢复红点', async () => {
    const { model } = await setup();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    cleanups.push(release);
    const reading = vi.fn<() => Promise<Response>>(async () => {
      await waiting;
      return success(rows);
    });
    server.use(mock.post('/backend/api/message/list', reading));
    const refreshing = model.refresh();
    await vi.waitFor(() => expect(reading).toHaveBeenCalledOnce());
    server.use(mock.post('/backend/api/message/read/:id', () => success(null)));
    await model.read('0');
    release();
    await refreshing;
    expect(model.messages.value.find(message => message.msgId === '0')?.isRead).toBe(true);
  });

  it('全部已读不抹掉提交之后到达的新消息', async () => {
    const { model, client } = await setup();
    const held = holdWrite();
    const writing = model.readAll();
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledOnce());
    client.setQueryData<Message[]>(['message-center', 'list', 'admin'], previous => [
      ...(previous ?? []),
      { ...messageFixture, msgId: 'new', isRead: false, category: 'resource' }
    ]);
    held.release();
    await writing;
    expect(model.unreadCount.value).toBe(1);
    expect(model.messages.value.find(message => message.msgId === 'new')?.isRead).toBe(false);
  });

  it('切换账号时同步隐藏上一账号的消息，迟到写入不污染新账号', async () => {
    const { model, session } = await setup();
    const held = holdWrite();
    const writing = model.read('0');
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledOnce());
    server.use(mock.post('/backend/api/message/list', () => success([])));
    session.start({
      token: createTestJwtExpiringAt(Date.now() + 7200000),
      user: { loginName: 'other', role: Role.user }
    });
    expect(model.messages.value).toEqual([]);
    held.release();
    await writing;
    expect(model.messages.value).toEqual([]);
  });

  it('卸载后已发出的写操作继续完成，不保留错误提示', async () => {
    const { model, wrapper } = await setup();
    const held = holdWrite();
    const writing = model.read('0');
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledOnce());
    wrapper.unmount();
    held.release();
    await writing;
    expect(model.isReading('0')).toBe(false);
    expect(model.selectedError.value).toBe('');
  });

  it('卸载会取消仍在等待的列表请求', async () => {
    const { model, wrapper } = await setup();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    cleanups.push(release);
    const handler = vi.fn<() => Promise<Response>>(async () => {
      await waiting;
      return success([]);
    });
    server.use(mock.post('/backend/api/message/list', handler));
    const refreshing = model.refresh();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    wrapper.unmount();
    // 取消应先于服务端回复结束等待，不依赖 MSW 内部 Request 是否转发 XHR 的 abort
    expect(await Promise.race([
      refreshing.then(() => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), 0))
    ])).toBe('settled');
    release();
    await refreshing;
    expect(model.messages.value).toHaveLength(24);
  });
});
