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
import { configureHttp } from '@/shared/http/configure';
import type { ResourceRecord } from '../api';
import { useResourceDetail } from '../composables/useResourceDetail';
import { resourceDetailResponse, resourceDirectoryResponse } from '../test-data';
import { ResourceDetailPanel } from './ResourceDetailPanel';

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

const row: ResourceRecord = {
  id: 'layer-1',
  name: '地类图斑',
  year: 2025,
  datasetName: '年度调查数据集',
  resourceName: '土地资源',
  layerCode: 'LAYER',
  datasetCode: 'DATASET',
  hasSlice: true,
  enabled: true
};

// 打开一个资源的详情：数据来源为空，第一个字段没有名称
async function openDetail() {
  const response = resourceDetailResponse();
  server.use(
    mock.get('/backend/resource-management/layer/struct', () =>
      HttpResponse.json({ ...response, data: { ...response.data, submit_unit: null } })
    )
  );
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3_600_000),
    user: { loginName: 'admin', role: Role.admin }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(client);
  const directories = resourceDirectoryResponse().data;
  let owner: ReturnType<typeof useResourceDetail> | undefined;
  const wrapper = mount(
    defineComponent(() => {
      const detail = useResourceDetail(directories);
      owner = detail;
      return () => <ResourceDetailPanel owner={detail} directories={directories} />;
    }),
    { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } }
  );
  if (!owner) {
    throw new Error('详情的拥有者没有创建');
  }
  owner.open(row, 'land');
  await vi.waitFor(() => expect(wrapper.text()).toContain('图斑名称'));
  return { wrapper, owner };
}

describe('ResourceDetailPanel', () => {
  it('空值和表格一样显示 -：元数据写出 -，属性表的空名称单元格不渲染内容，交给全局样式', async () => {
    const { wrapper } = await openDetail();
    const source = wrapper.findAll('dt').find(item => item.text() === '数据来源');

    expect(source?.element.nextElementSibling?.textContent).toBe('-');
    const nameCells = wrapper.findAll('.el-table__body tr').map(item => item.find('td .cell'));
    expect(nameCells.map(cell => cell.text())).toEqual(['', '图斑名称']);
    expect(nameCells[0]?.element.children).toHaveLength(0);
  });

  it('编辑时名称是输入框，空名称的输入框为空', async () => {
    const { wrapper, owner } = await openDetail();
    owner.beginEdit();
    await wrapper.vm.$nextTick();

    const inputs = wrapper.findAll<HTMLInputElement>('.el-table__body input');
    expect(inputs.map(input => input.element.value)).toEqual(['', '图斑名称']);
  });
});
