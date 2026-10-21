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
import type { ResourceDirectory } from '../api';
import { resourceManagementKeys } from '../queries';
import { resourceDirectoryResponse, resourcePageResponse, resourceYearsResponse } from '../test-data';
import { useDirectoryEditor } from './useDirectoryEditor';
import { useResourceList } from './useResourceList';

const server = setupServer();
const clients: QueryClient[] = [];
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

/** 目录写入只在 MSW 内存里执行，可控制失败和完成时刻 */
function backend() {
  const tree: ResourceDirectory[] = resourceDirectoryResponse().data;
  const writes: string[] = [];
  const pages: string[] = [];
  let failure = false;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let aborted = false;
  server.use(
    mock.get('/backend/resource-center/tree', () => HttpResponse.json({ code: 200, data: tree })),
    mock.get('/backend/resource-center/year/list', () => HttpResponse.json(resourceYearsResponse())),
    mock.post('/backend/resource-management/layer/page', async ({ request }) => {
      const params = await request.json() as { resource: string; pageNum: number; pageSize: number };
      pages.push(params.resource);
      return HttpResponse.json(resourcePageResponse(params));
    }),
    mock.post('/backend/resource-management/menu/:action', async ({ request, params }) => {
      const action = String(params.action);
      writes.push(action);
      request.signal.addEventListener('abort', () => { aborted = true; });
      await gate;
      if (failure) { return HttpResponse.json({ code: 500, msg: '目录操作失败' }); }
      if (action === 'delete') {
        const id = new URL(request.url).searchParams.get('id');
        tree.forEach(group => { group.children = group.children?.filter(node => node.id !== id); });
      } else {
        const body = await request.json() as { name: string; parentId?: string; id?: string };
        if (action === 'add') {
          const group = tree.find(node => node.id === body.parentId);
          if (group) { group.children = [...(group.children ?? []), { id: 'new', name: body.name }]; }
        } else {
          const node = tree.flatMap(group => group.children ?? []).find(child => child.id === body.id);
          if (node) { node.name = body.name; }
        }
      }
      return HttpResponse.json({ code: 200, data: null });
    })
  );
  return { tree, writes, pages, fail: (value: boolean) => { failure = value; },
    hold: () => { gate = new Promise<void>(resolve => { release = resolve; }); },
    release: () => release?.(), aborted: () => aborted };
}

function host() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({ token: createTestJwtExpiringAt(Date.now() + 3_600_000), user: { loginName: 'admin', role: Role.admin } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(client);
  let editor!: ReturnType<typeof useDirectoryEditor>;
  let list!: ReturnType<typeof useResourceList>;
  const wrapper = mount(defineComponent({ setup() {
    list = useResourceList();
    editor = useDirectoryEditor(() => list.directoryQuery.data.value ?? []);
    return () => null;
  } }), { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } });
  return { editor, list, wrapper, client, session };
}

describe('目录维护流程', () => {
  it('空名称与超长名称不发请求；取消后重新打开不保留草稿和错误', async () => {
    const api = backend();
    const { editor, list } = host();
    await vi.waitFor(() => expect(list.directoryId.value).toBe('land'));
    editor.open('add', 'base');
    editor.setName('   ');
    expect(await editor.submit()).toBe(false);
    expect(editor.error.value).toBe('请输入目录名称');
    editor.setName('长'.repeat(21));
    expect(await editor.submit()).toBe(false);
    expect(editor.error.value).toContain('20');
    editor.close();
    editor.open('add', 'base');
    expect([editor.name.value, editor.error.value]).toEqual(['', '']);
    expect(api.writes).toEqual([]);
  });

  it('新增空分组的二级目录，trim 名称并保留原选择', async () => {
    backend();
    const { editor, list } = host();
    await vi.waitFor(() => expect(list.directoryId.value).toBe('land'));
    editor.open('add', 'three');
    editor.setName(' 新目录 ');
    expect(await editor.submit()).toBe(true);
    expect(list.directoryQuery.data.value?.at(-1)?.children).toEqual([{ id: 'new', name: '新目录' }]);
    expect(list.directoryId.value).toBe('land');
    expect(editor.target.value).toBeNull();
  });

  it('重命名当前目录后标题、查询名称和筛选同步，删除当前目录重新选择有效节点', async () => {
    const api = backend();
    const { editor, list } = host();
    await vi.waitFor(() => expect(list.resources.value).toHaveLength(20));
    list.filterForm.name = '草稿';
    list.pageNum.value = 2;
    editor.open('rename', 'land');
    editor.setName(' 土地调查 ');
    expect(await editor.submit()).toBe(true);
    expect(list.selectedDirectory.value?.name).toBe('土地调查');
    expect(list.pageNum.value).toBe(1);
    expect(list.filterForm.name).toBe('');
    expect(api.pages).toContain('土地调查');
    editor.open('remove', 'land');
    expect(await editor.submit()).toBe(true);
    expect(list.directoryId.value).toBe('water');
    expect(list.resources.value[0]?.resourceName).toBe('水资源');
  });

  it('操作失败保留名称和弹窗，重试成功；期间不能重复提交、关闭或换目标', async () => {
    const api = backend();
    const { editor, list } = host();
    await vi.waitFor(() => expect(list.directoryId.value).toBe('land'));
    editor.open('rename', 'land');
    editor.setName('失败后重试');
    api.fail(true);
    expect(await editor.submit()).toBe(false);
    expect(editor.error.value).toBe('目录操作失败');
    expect(editor.name.value).toBe('失败后重试');
    api.fail(false);
    api.hold();
    const pending = editor.submit();
    await vi.waitFor(() => expect(api.writes).toHaveLength(2));
    editor.close();
    editor.open('remove', 'water');
    expect(editor.target.value?.id).toBe('land');
    expect(await editor.submit()).toBe(false);
    api.release();
    expect(await pending).toBe(true);
    expect(api.writes).toEqual(['edit', 'edit']);
  });

  it.each(['session', 'unmount'] as const)('确认期间 %s 变化后不再提交', async kind => {
    const api = backend();
    const { editor, list, session, wrapper } = host();
    await vi.waitFor(() => expect(list.directoryId.value).toBe('land'));
    editor.open('remove', 'land');
    if (kind === 'session') { session.clear(); } else { wrapper.unmount(); }
    expect(await editor.submit()).toBe(false);
    expect(api.writes).toEqual([]);
  });

  it('写请求发出后卸载不取消；完成后不显示成功', async () => {
    const api = backend();
    const { editor, list, wrapper } = host();
    await vi.waitFor(() => expect(list.directoryId.value).toBe('land'));
    editor.open('remove', 'land');
    api.hold();
    const pending = editor.submit();
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    wrapper.unmount();
    api.release();
    expect(await pending).toBe(false);
    expect(api.aborted()).toBe(false);
  });

  it('旧会话的写入完成后不失效新会话缓存', async () => {
    const api = backend();
    const { editor, list, client, session, wrapper } = host();
    await vi.waitFor(() => expect(list.directoryId.value).toBe('land'));
    editor.open('remove', 'land');
    api.hold();
    const pending = editor.submit();
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    wrapper.unmount();
    session.start({ token: 'another-session', user: { loginName: 'new', role: Role.admin } });
    client.setQueryData(resourceManagementKeys.directory(), []);
    api.release();
    expect(await pending).toBe(false);
    expect(client.getQueryState(resourceManagementKeys.directory())?.isInvalidated).toBe(false);
  });

  it('原样重命名无需写入，过期目录快照不能提交', async () => {
    backend();
    const { editor, list, client } = host();
    await vi.waitFor(() => expect(list.directoryId.value).toBe('land'));
    editor.open('rename', 'land');
    expect(await editor.submit()).toBe(false);
    expect(editor.target.value).toBeNull();
    editor.open('remove', 'land');
    client.setQueryData(resourceManagementKeys.directory(), []);
    expect(await editor.submit()).toBe(false);
    expect(editor.error.value).toContain('目录已变化');
  });
});
