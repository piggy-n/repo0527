import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { configureHttp } from '@/shared/http/configure';
import type { ResourceAttribute, ResourceDirectory, ResourceRecord } from '../api';
import { resourceManagementKeys } from '../queries';
import { resourceDetailResponse, resourceDirectoryResponse } from '../test-data';
import { useResourceDetail } from './useResourceDetail';

const server = setupServer();
const clients: QueryClient[] = [];
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  server.resetHandlers();
  localStorage.clear();
  configureHttp({});
});
afterAll(() => server.close());

function row(id = 'layer-1'): ResourceRecord {
  return { id, name: '地类图斑', year: 2025, resourceName: '土地资源', datasetName: '数据集',
    layerCode: 'LAYER', datasetCode: 'DATASET', hasSlice: true, enabled: true };
}

function backend() {
  const data = resourceDetailResponse().data;
  const state: {
    failRead: boolean; failWrite: boolean; expiredRead: boolean; returned: number;
    holdRead?: Promise<void>; holdWrite?: Promise<void>
  } = {
    failRead: false, failWrite: false, expiredRead: false, returned: 0
  };
  const reads: string[] = [];
  const writes: { id: string | null; resourceName: string | null; attributes: ResourceAttribute[] }[] = [];
  const aborted: string[] = [];
  server.use(
    mock.get('/backend/resource-management/layer/struct', async ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')!;
      reads.push(id);
      request.signal.addEventListener('abort', () => aborted.push(id));
      await state.holdRead;
      state.returned++;
      if (state.expiredRead) { return HttpResponse.json({ code: 401, msg: '旧请求过期' }); }
      return HttpResponse.json(state.failRead ? { code: 500, msg: '详情读取失败' } : { code: 200, data: { ...data, id } });
    }),
    mock.put('/backend/resource-management/layer/edit-struct', async ({ request }) => {
      const attributes = await request.json() as ResourceAttribute[];
      const query = new URL(request.url).searchParams;
      writes.push({ id: query.get('id'), resourceName: query.get('resourceName'), attributes });
      request.signal.addEventListener('abort', () => aborted.push('write'));
      await state.holdWrite;
      if (state.failWrite) { return HttpResponse.json({ code: 500, msg: '保存被拒绝' }); }
      data.resourceName = query.get('resourceName')!;
      // 仅模拟后端保存名称，其余字段由契约测试检查完整往返
      data.attributes.forEach((attribute, index) => { attribute.name = attributes[index]?.name ?? null; });
      return HttpResponse.json({ code: 200, data: null });
    })
  );
  return { data, state, reads, writes, aborted };
}

function host() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({ token: createTestJwtExpiringAt(Date.now() + 3_600_000), user: { loginName: 'admin', role: Role.admin } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(client);
  const tree = ref<ResourceDirectory[]>(resourceDirectoryResponse().data);
  let detail!: ReturnType<typeof useResourceDetail>;
  const wrapper = mount(defineComponent({ setup() {
    detail = useResourceDetail(tree);
    return () => null;
  } }), { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } });
  return { detail, wrapper, client, session, tree };
}

async function startEditing(detail: ReturnType<typeof useResourceDetail>) {
  detail.open(row(), 'land');
  await vi.waitFor(() => expect(detail.detail.value?.id).toBe('layer-1'));
  detail.beginEdit();
  expect(detail.editing.value).toBe(true);
}

describe('资源详情与属性草稿', () => {
  it('草稿不改缓存，后台刷新不覆盖输入；保存 trim/null 并保留其余字段，失效列表', async () => {
    const api = backend();
    const { detail, client } = host();
    const pageKey = [...resourceManagementKeys.pages(), 'cached'];
    client.setQueryData(pageKey, []);
    await startEditing(detail);
    detail.setName(0, ' 标识码 ');
    detail.setName(1, '  ');
    detail.setCategory('water');
    expect(detail.detail.value?.attributes[0]?.name).toBeNull();
    await detail.query.refetch();
    expect(detail.draft.value?.attributes[0]?.name).toBe(' 标识码 ');
    const original = resourceDetailResponse().data.attributes;
    expect(await detail.save()).toBe(true);
    expect(api.writes).toEqual([{ id: 'layer-1', resourceName: '水资源', attributes: [
      { ...original[0], name: '标识码' }, { ...original[1], name: null }
    ] }]);
    expect(detail.editing.value).toBe(false);
    expect(detail.detail.value?.attributes[0]?.name).toBe('标识码');
    expect(detail.detail.value?.resourceName).toBe('水资源');
    expect(client.getQueryState(pageKey)?.isInvalidated).toBe(true);
  });

  it('未改动不写入；失败保留草稿，重试期间防重复、关闭、换资源和改输入', async () => {
    const api = backend();
    const { detail } = host();
    await startEditing(detail);
    expect(await detail.save()).toBe(false);
    detail.setName(0, '重试名称');
    api.state.failWrite = true;
    expect(await detail.save()).toBe(false);
    expect(detail.error.value).toBe('保存被拒绝');
    expect(detail.draft.value?.attributes[0]?.name).toBe('重试名称');
    api.state.failWrite = false;
    let release!: () => void;
    api.state.holdWrite = new Promise<void>(resolve => { release = resolve; });
    const saving = detail.save();
    await vi.waitFor(() => expect(api.writes).toHaveLength(2));
    expect(await detail.save()).toBe(false);
    expect(await detail.close()).toBe(false);
    detail.open(row('other'), 'land');
    detail.setName(0, '不得写入');
    detail.setCategory('water');
    expect(detail.target.value?.id).toBe('layer-1');
    expect(detail.draft.value?.attributes[0]?.name).toBe('重试名称');
    expect(detail.draft.value?.category?.id).toBe('land');
    release();
    expect(await saving).toBe(true);
  });

  it('未保存确认拒绝保留输入，接受才退出；重复离开不会共用许可', async () => {
    backend();
    const { detail } = host();
    await startEditing(detail);
    detail.setName(0, '未保存');
    const canceled = detail.close();
    expect(detail.confirming.value).toBe(true);
    expect(await detail.close()).toBe(false);
    detail.answerDiscard(false);
    expect(await canceled).toBe(false);
    expect(detail.draft.value?.attributes[0]?.name).toBe('未保存');
    const discarded = detail.cancelEdit();
    detail.answerDiscard(true);
    await discarded;
    expect(detail.editing.value).toBe(false);
    expect(detail.target.value?.id).toBe('layer-1');
    expect(await detail.close()).toBe(true);
    expect(detail.target.value).toBeNull();
  });

  it('切换详情立即隐藏旧值，未完成读取取消；卸载取消新读取', async () => {
    const api = backend();
    const { detail, wrapper, client } = host();
    const onUnauthorized = vi.fn<() => void>();
    configureHttp({ onUnauthorized });
    detail.open(row(), 'land');
    await vi.waitFor(() => expect(detail.detail.value?.id).toBe('layer-1'));
    let release!: () => void;
    api.state.holdRead = new Promise<void>(resolve => { release = resolve; });
    detail.open(row('slow'), 'land');
    expect(detail.detail.value).toBeUndefined();
    await vi.waitFor(() => expect(api.reads).toContain('slow'));
    detail.open(row('latest'), 'water');
    await vi.waitFor(() => expect(api.reads).toContain('latest'));
    expect(client.getQueryState(resourceManagementKeys.detail('slow'))?.fetchStatus).toBe('idle');
    wrapper.unmount();
    expect(client.getQueryState(resourceManagementKeys.detail('latest'))?.fetchStatus).toBe('idle');
    api.state.expiredRead = true;
    release();
    await vi.waitFor(() => expect(api.state.returned).toBe(3));
    await flushPromises();
    await flushPromises();
    expect(client.getQueryData(resourceManagementKeys.detail('slow'))).toBeUndefined();
    expect(client.getQueryData(resourceManagementKeys.detail('latest'))).toBeUndefined();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('详情失败不能编辑，重试恢复；保存后的刷新失败退出编辑，只重试读取', async () => {
    const api = backend();
    const { detail } = host();
    api.state.failRead = true;
    detail.open(row(), 'land');
    await vi.waitFor(() => expect(detail.query.isError.value).toBe(true));
    detail.beginEdit();
    expect(detail.editing.value).toBe(false);
    api.state.failRead = false;
    await detail.query.refetch();
    detail.beginEdit();
    detail.setName(0, '已提交');
    api.state.failRead = true;
    expect(await detail.save()).toBe(true);
    expect(detail.editing.value).toBe(false);
    expect(detail.query.isError.value).toBe(true);
    detail.beginEdit();
    expect(detail.editing.value).toBe(false);
    api.state.failRead = false;
    await detail.query.refetch();
    expect(detail.detail.value?.attributes[0]?.name).toBe('已提交');
    expect(api.writes).toHaveLength(1);
  });

  it('分类未匹配不能静默猜测，目录改名后必须重新选择；空属性也可改分类', async () => {
    const api = backend();
    api.data.resourceName = '未知分类';
    api.data.attributes = [];
    const { detail, tree } = host();
    await startEditing(detail);
    expect(detail.draft.value?.category).toBeNull();
    detail.setCategory('water');
    tree.value[0].children![1].name = '水资源新名';
    expect(await detail.save()).toBe(false);
    expect(detail.error.value).toContain('请选择有效');
    detail.setCategory('water');
    expect(await detail.save()).toBe(true);
    expect(api.writes[0]).toEqual({ id: 'layer-1', resourceName: '水资源新名', attributes: [] });
  });

  it.each(['session', 'unmount'] as const)('确认期间 %s 变化不会继续离开或写入', async kind => {
    const api = backend();
    const { detail, session, wrapper } = host();
    await startEditing(detail);
    detail.setName(0, '未保存');
    const leaving = detail.close();
    if (kind === 'session') { session.clear(); } else { wrapper.unmount(); }
    expect(await leaving).toBe(false);
    detail.answerDiscard(true);
    expect(await detail.save()).toBe(false);
    expect(api.writes).toEqual([]);
  });

  it.each(['session', 'unmount'] as const)('保存期间 %s 变化不取消写入，不显示旧成功', async kind => {
    const api = backend();
    const { detail, session, wrapper, client } = host();
    await startEditing(detail);
    detail.setName(0, '已发送');
    let release!: () => void;
    api.state.holdWrite = new Promise<void>(resolve => { release = resolve; });
    const saving = detail.save();
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    wrapper.unmount();
    if (kind === 'session') {
      session.start({ token: 'another-session', user: { loginName: 'new', role: Role.admin } });
    }
    client.setQueryData(resourceManagementKeys.detail('layer-1'), resourceDetailResponse().data);
    release();
    expect(await saving).toBe(false);
    expect(api.aborted).not.toContain('write');
    expect(client.getQueryState(resourceManagementKeys.detail('layer-1'))?.isInvalidated).toBe(kind !== 'session');
  });

  it('同名分类优先当前目录身份，其他同名不猜测；普通用户不能编辑', async () => {
    backend();
    const { detail, tree, session } = host();
    tree.value.push({ id: 'other-group', name: '其他', children: [{ id: 'duplicate', name: '土地资源' }] });
    await startEditing(detail);
    expect(detail.draft.value?.category?.id).toBe('land');
    await detail.cancelEdit();
    detail.open(row(), 'missing');
    await nextTick();
    detail.beginEdit();
    expect(detail.draft.value?.category).toBeNull();
    await detail.cancelEdit();
    session.start({ token: session.token!, user: { loginName: 'user', role: Role.user } });
    detail.beginEdit();
    expect(detail.editing.value).toBe(false);
  });
});
