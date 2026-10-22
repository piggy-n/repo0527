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
import type { ResourceRecord } from '../api';
import { resourceManagementKeys } from '../queries';
import { resourceDetailResponse, resourceDirectoryResponse } from '../test-data';
import { useResourceDetail } from './useResourceDetail';
import { validateResourceExcel } from './useResourceImport';

const server = setupServer();
const clients: QueryClient[] = [];
const releases = new Set<() => void>();
const file = () => new File(['固定测试内容'], '属性规范.XLSX');
const row: ResourceRecord = { id: 'layer-1', name: '资源', year: 2024, datasetName: '数据集', resourceName: '土地资源',
  layerCode: 'LAYER', datasetCode: 'DATASET', hasSlice: true, enabled: true };
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  releases.forEach(release => release());
  releases.clear();
  clients.splice(0).forEach(client => client.clear());
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

/** 单元测试只验证业务状态；原生 multipart 文件内容在产物浏览器测试断言 */
function backend() {
  const data = resourceDetailResponse().data;
  const state = { fail: false, network: false, failRead: false, hold: false, reads: 0 };
  const writes: { release: () => void; aborted: boolean }[] = [];
  server.use(
    mock.get('/backend/resource-management/layer/struct', () => {
      state.reads++;
      return HttpResponse.json(state.failRead ? { code: 500, msg: '读取失败' } : { code: 200, data });
    }),
    mock.post('/backend/resource-management/layer/create-attribute-by-excel', async ({ request }) => {
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const write = { release, aborted: false };
      writes.push(write);
      releases.add(release);
      request.signal.addEventListener('abort', () => {
        write.aborted = true;
      });
      if (state.hold) {
        await gate;
      }
      releases.delete(release);
      if (state.network) {
        return HttpResponse.error();
      }
      if (state.fail) {
        return HttpResponse.json({ code: 500, msg: '模板不符合要求' });
      }
      data.attributes[0].name = '导入后的名称';
      return HttpResponse.json({ code: 200, data: { unknown: '不解释此结果' } });
    })
  );
  return { state, writes };
}

async function host() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({ token: createTestJwtExpiringAt(Date.now() + 3_600_000), user: { loginName: 'admin', role: Role.admin } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(client);
  let detail!: ReturnType<typeof useResourceDetail>;
  const wrapper = mount(defineComponent({ setup() {
    detail = useResourceDetail(resourceDirectoryResponse().data);
    return () => null;
  } }), { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } });
  detail.open(row, 'land');
  await vi.waitFor(() => expect(detail.detail.value?.id).toBe(row.id));
  return { detail, importer: detail.importer, client, session, wrapper };
}

async function expectBlocked(result: Promise<boolean>) {
  expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('unexpected-pending'), 0))]))
    .toBe(false);
}

describe('Excel 导入业务', () => {
  it('接受旧版两种扩展名和大写，不猜测大小上限；拒绝空文件和错误格式', () => {
    expect(validateResourceExcel(file())).toBe('');
    expect(validateResourceExcel({ name: '属性.xls', size: 500_000_000 })).toBe('');
    expect(validateResourceExcel({ name: '属性.xlsx.exe', size: 10 })).toContain('.xlsx');
    expect(validateResourceExcel({ name: '空.xlsx', size: 0 })).toContain('为空');
  });

  it('非法文件不发请求；成功重读当前详情并失效全部相关缓存，不解释未知结果', async () => {
    const api = backend();
    const { importer, detail, client } = await host();
    const keys = [[...resourceManagementKeys.pages(), 'cached'], resourceManagementKeys.detail('other'),
      resourceManagementKeys.years(), ['other-feature']];
    keys.forEach(key => client.setQueryData(key, []));
    expect(await importer.upload(new File([], '空.xlsx'))).toBe(false);
    expect(importer.message.value).toContain('为空');
    expect(api.writes).toHaveLength(0);
    expect(await importer.upload(file())).toBe(true);
    expect(importer.stage.value).toBe('success');
    expect(importer.message.value).toBe('导入成功');
    expect(detail.detail.value?.attributes[0]?.name).toBe('导入后的名称');
    expect(keys.map(key => client.getQueryState(key)?.isInvalidated)).toEqual([true, true, true, false]);
  });

  it('立即防重复，导入中不能编辑、返回或切换详情；编辑中不能导入', async () => {
    const api = backend();
    const { importer, detail } = await host();
    detail.beginEdit();
    await expectBlocked(importer.upload(file()));
    await detail.cancelEdit();
    api.state.hold = true;
    const pending = importer.upload(file());
    expect(importer.pending.value).toBe(true);
    await expectBlocked(importer.upload(file()));
    await expectBlocked(detail.close());
    await expectBlocked(detail.allowLeave());
    detail.beginEdit();
    expect(detail.editing.value).toBe(false);
    detail.open({ ...row, id: 'other' }, 'land');
    expect(detail.target.value?.id).toBe(row.id);
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    api.writes[0].release();
    expect(await pending).toBe(true);
    expect(importer.pending.value).toBe(false);
  });

  it('业务失败显示原因，不自动重试；重新选择后可再次上传', async () => {
    const api = backend();
    const { importer } = await host();
    api.state.fail = true;
    expect(await importer.upload(file())).toBe(false);
    expect(importer.message.value).toBe('模板不符合要求');
    expect(api.writes).toHaveLength(1);
    api.state.fail = false;
    expect(await importer.upload(file())).toBe(true);
    expect(api.writes).toHaveLength(2);
  });

  it('网络异常不宣称导入已撤销或失败回滚', async () => {
    const api = backend();
    const { importer } = await host();
    api.state.network = true;
    expect(await importer.upload(file())).toBe(false);
    expect(importer.message.value).toBe('导入结果未确认，请核对属性后重试');
    expect(api.writes).toHaveLength(1);
  });

  it('写入成功但刷新失败仍表示导入成功，详情独立暴露读取错误', async () => {
    const api = backend();
    const { importer, detail } = await host();
    api.state.failRead = true;
    expect(await importer.upload(file())).toBe(true);
    expect(importer.stage.value).toBe('success');
    expect(detail.query.isError.value).toBe(true);
    await expectBlocked(importer.upload(file()));
    expect(api.writes).toHaveLength(1);
  });

  it('卸载不取消写入，不显示晚到结果', async () => {
    const api = backend();
    const { importer, wrapper } = await host();
    api.state.hold = true;
    const pending = importer.upload(file());
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    wrapper.unmount();
    api.writes[0].release();
    expect(await pending).toBe(false);
    expect(api.writes[0].aborted).toBe(false);
    expect(importer.message.value).toBe('');
  });

  it('会话切换后旧响应不失效新缓存或显示结果；普通用户与过期会话不能上传', async () => {
    const api = backend();
    const { importer, detail, session, client } = await host();
    api.state.hold = true;
    const pending = importer.upload(file());
    await vi.waitFor(() => expect(api.writes).toHaveLength(1));
    session.start({ token: createTestJwtExpiringAt(Date.now() + 7_200_000), user: { loginName: 'new', role: Role.user } });
    client.setQueryData(resourceManagementKeys.detail('other'), []);
    api.writes[0].release();
    expect(await pending).toBe(false);
    expect(client.getQueryState(resourceManagementKeys.detail('other'))?.isInvalidated).toBe(false);
    expect(importer.stage.value).toBe('idle');
    detail.open(row, 'land');
    await expectBlocked(importer.upload(file()));
    session.start({ token: createTestJwtExpiringAt(Date.now() - 1000), user: { loginName: 'old', role: Role.admin } });
    await expectBlocked(importer.upload(file()));
    expect(api.writes).toHaveLength(1);
  });
});
