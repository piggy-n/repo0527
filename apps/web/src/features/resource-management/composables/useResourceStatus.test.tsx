import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { resourceManagementKeys } from '../queries';
import { resourceDirectoryResponse, resourcePageResponse, resourceYearsResponse } from '../test-data';
import { useResourceList } from './useResourceList';
import { useResourceStatus } from './useResourceStatus';

const server = setupServer();
const clients: QueryClient[] = [];
const releases = new Set<() => void>();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  releases.forEach(release => release());
  releases.clear();
  clients.splice(0).forEach(client => client.clear());
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

/** 在固定数据中模拟持久状态，允许按行控制写入的完成顺序 */
function backend() {
  const state = { hold: false, fail: false, failRead: false };
  const enabled = new Map<string, boolean>();
  const writes: { id: string; value: boolean; release: () => void }[] = [];
  server.use(
    mock.get('/backend/resource-center/tree', () => HttpResponse.json(resourceDirectoryResponse())),
    mock.get('/backend/resource-center/year/list', () => HttpResponse.json(resourceYearsResponse())),
    mock.post('/backend/resource-management/layer/page', async ({ request }) => {
      if (state.failRead) { return HttpResponse.json({ code: 500, msg: '刷新失败' }); }
      const params = await request.json() as { resource: string; pageNum: number; pageSize: number };
      const response = resourcePageResponse(params);
      response.data.list.forEach(row => { if (enabled.has(row.id)) { row.enable = String(enabled.get(row.id)); } });
      return HttpResponse.json(response);
    }),
    mock.post('/backend/resource-management/layer/status', async ({ request }) => {
      const query = new URL(request.url).searchParams;
      const id = query.get('id')!;
      const value = query.get('status') === 'true';
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      writes.push({ id, value, release });
      releases.add(release);
      if (state.hold) { await gate; }
      releases.delete(release);
      if (state.fail) { return HttpResponse.json({ code: 500, msg: '启停失败' }); }
      enabled.set(id, value);
      return HttpResponse.json({ code: 200 });
    })
  );
  return { state, writes, enabled };
}

async function host() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({ token: createTestJwtExpiringAt(Date.now() + 3_600_000), user: { loginName: 'admin', role: Role.admin } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(client);
  let list!: ReturnType<typeof useResourceList>;
  let status!: ReturnType<typeof useResourceStatus>;
  const wrapper = mount(defineComponent({ setup() {
    list = useResourceList();
    status = useResourceStatus(list.resources, () => !list.isError.value && !list.refreshing.value);
    return () => null;
  } }), { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } });
  await vi.waitFor(() => expect(list.resources.value).toHaveLength(10));
  return { status, list, client, session, wrapper };
}

/** 拒绝操作只经过微任务；错误地发起等待请求时直接断言失败，避免依赖用例超时 */
async function expectBlocked(result: Promise<unknown>) {
  expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('unexpected-pending'), 0))]))
    .toBeNull();
}

describe('按资源 ID 的启停写操作', () => {
  it('同 ID 防重复，不同 ID 并发且可逆序完成；等待时不改旧记录', async () => {
    const api = backend();
    const { status, list } = await host();
    const first = list.resources.value[0];
    const second = list.resources.value[1];
    api.state.hold = true;
    const one = status.toggle(first.id);
    const two = status.toggle(second.id);
    expect(status.pending.has(first.id)).toBe(true);
    await expectBlocked(status.toggle(first.id));
    await vi.waitFor(() => expect(api.writes).toHaveLength(2));
    expect(list.resources.value[0]?.enabled).toBe(first.enabled);
    api.writes[1].release();
    expect(await two).toEqual({ kind: 'success', enabled: !second.enabled });
    expect(status.pending.has(first.id)).toBe(true);
    expect(status.pending.has(second.id)).toBe(false);
    api.writes[0].release();
    expect(await one).toEqual({ kind: 'success', enabled: !first.enabled });
    expect(status.pending.size).toBe(0);
    expect(list.resources.value.slice(0, 2).map(row => row.enabled)).toEqual([!first.enabled, !second.enabled]);
    expect(first.enabled).toBe(true);
  });

  it('启停失败保持接口状态并可重试；成功只失效本模块列表和对应详情', async () => {
    const api = backend();
    const { status, list, client } = await host();
    const row = list.resources.value[0];
    const otherKey = ['unrelated-feature', 'list'];
    client.setQueryData(resourceManagementKeys.detail(row.id), { id: row.id });
    client.setQueryData(resourceManagementKeys.detail('other'), { id: 'other' });
    client.setQueryData(otherKey, []);
    api.state.fail = true;
    expect(await status.toggle(row.id)).toEqual({ kind: 'error', message: '启停失败' });
    expect(list.resources.value[0]?.enabled).toBe(row.enabled);
    expect(status.pending.size).toBe(0);
    api.state.fail = false;
    expect(await status.toggle(row.id)).toEqual({ kind: 'success', enabled: !row.enabled });
    expect(client.getQueryState(resourceManagementKeys.detail(row.id))?.isInvalidated).toBe(true);
    expect(client.getQueryState(resourceManagementKeys.detail('other'))?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it('保存成功后刷新失败保留旧列表并禁止继续切换，重试读取恢复', async () => {
    const api = backend();
    const { status, list } = await host();
    const row = list.resources.value[0];
    api.state.failRead = true;
    expect(await status.toggle(row.id)).toEqual({ kind: 'success', enabled: !row.enabled });
    expect(list.isError.value).toBe(true);
    expect(list.resources.value[0]?.enabled).toBe(row.enabled);
    expect(await status.toggle(row.id)).toBeNull();
    api.state.failRead = false;
    await list.refresh();
    expect(list.resources.value[0]?.enabled).toBe(!row.enabled);
    expect(api.writes).toHaveLength(1);
  });

  it('切目录期间按原资源记进行中状态，返回后仍防重复', async () => {
    const api = backend();
    const { status, list } = await host();
    const row = list.resources.value[0];
    api.state.hold = true;
    const pending = status.toggle(row.id);
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    list.selectDirectory('water');
    await vi.waitFor(() => expect(list.resources.value[0]?.resourceName).toBe('水资源'));
    expect(status.pending.has(row.id)).toBe(true);
    await expectBlocked(status.toggle(row.id));
    list.selectDirectory('land');
    await vi.waitFor(() => expect(list.resources.value[0]?.id).toBe(row.id));
    await expectBlocked(status.toggle(row.id));
    api.writes[0].release();
    expect(await pending).toMatchObject({ kind: 'success' });
    expect(list.resources.value[0]?.enabled).toBe(!row.enabled);
  });

  it('普通用户、过期会话、缺失资源和已卸载的入口不发写请求', async () => {
    const api = backend();
    const { status, list, session, wrapper } = await host();
    const id = list.resources.value[0].id;
    expect(await status.toggle('missing')).toBeNull();
    session.start({ token: session.token!, user: { loginName: 'user', role: Role.user } });
    expect(await status.toggle(id)).toBeNull();
    session.start({ token: createTestJwtExpiringAt(Date.now() - 1000), user: { loginName: 'admin', role: Role.admin } });
    expect(await status.toggle(id)).toBeNull();
    wrapper.unmount();
    expect(await status.toggle(id)).toBeNull();
    expect(api.writes).toEqual([]);
  });

  it('卸载不取消已发出的写操作，完成后不返回 UI 成功', async () => {
    const api = backend();
    const { status, list, wrapper } = await host();
    const row = list.resources.value[0];
    api.state.hold = true;
    const pending = status.toggle(row.id);
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    wrapper.unmount();
    api.writes[0].release();
    expect(await pending).toBeNull();
    expect(api.enabled.get(row.id)).toBe(!row.enabled);
  });

  it('旧会话结果不失效新缓存，也不解除新会话同 ID 操作的进行中状态', async () => {
    const api = backend();
    const { status, list, session, client } = await host();
    const row = list.resources.value[0];
    api.state.hold = true;
    const old = status.toggle(row.id);
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    session.start({ token: createTestJwtExpiringAt(Date.now() + 7_200_000), user: { loginName: 'new', role: Role.admin } });
    client.setQueryData(resourceManagementKeys.detail(row.id), { id: row.id });
    const latest = status.toggle(row.id);
    await vi.waitFor(() => expect(api.writes).toHaveLength(2));
    api.writes[0].release();
    expect(await old).toBeNull();
    expect(client.getQueryState(resourceManagementKeys.detail(row.id))?.isInvalidated).toBe(false);
    expect(status.pending.has(row.id)).toBe(true);
    api.writes[1].release();
    expect(await latest).toMatchObject({ kind: 'success' });
    expect(status.pending.has(row.id)).toBe(false);
  });
});
