import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessage } from 'element-plus';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import {
  applicationPageResponse,
  approvedRecord,
  envelope,
  pendingRecord,
  tableRecord
} from '@/features/data-application/test-data';
import { messageKeys } from '@/features/message-center/queries';
import { reportPageResponse, reportRecord } from '@/features/statistics-report/test-data';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { RouteName } from '@/shared/router/route-names';
import { ResourceApplicationPage } from './ResourceApplicationPage';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
// 时间按北京时间显示，不随运行环境的时区变化
beforeEach(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles');
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  localStorage.clear();
});
afterAll(() => server.close());

// 申请：待审核、准备中、准备完成、不通过、统计任务各一条；报表一条。记下列表、详情、报表的请求次数和下载的请求
function mockBackend() {
  const records = [
    pendingRecord(),
    approvedRecord({ storage_status: 'processing' }),
    approvedRecord({ apply_id: 'apply-ready', apply_name: '医疗机构面层', storage_status: 'success' }),
    approvedRecord({
      apply_id: 'apply-rejected',
      apply_name: '地类图斑',
      status: 'rejected',
      remark: '范围超出职责',
      storage_status: undefined
    }),
    tableRecord()
  ];
  const state = { list: 0, detail: 0, reports: 0, downloads: [] as string[] };
  server.use(
    mock.post('/backend/api/apply/list', () => {
      state.list += 1;
      return HttpResponse.json(applicationPageResponse(records));
    }),
    mock.get('/backend/api/apply/:id', ({ params }) => {
      state.detail += 1;
      return HttpResponse.json(envelope(records.find(record => record.apply_id === params.id) ?? null));
    }),
    mock.post('/backend/statistics/page', () => {
      state.reports += 1;
      return HttpResponse.json(reportPageResponse([reportRecord()]));
    }),
    mock.post('/backend/api/apply/download/:id', ({ params }) => {
      state.downloads.push(`POST ${String(params.id)}`);
      return new HttpResponse('数据', { headers: { 'Content-Type': 'application/zip' } });
    }),
    mock.get('/backend/statistics/download', ({ request }) => {
      state.downloads.push(`GET ${new URL(request.url).searchParams.get('id') ?? ''}`);
      return new HttpResponse('报表', { headers: { 'Content-Type': 'application/zip' } });
    })
  );
  return state;
}

// 记下交给浏览器保存的文件名；jsdom 没有 URL.createObjectURL
function stubSave() {
  const saved: string[] = [];
  class TestURL extends URL {
    static override createObjectURL = () => 'blob:test';
    static override revokeObjectURL = () => undefined;
  }
  vi.stubGlobal('URL', TestURL);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
  return saved;
}

// 未读的缓存里放几条：页面只看条数，不看内容
const unreadOf = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `msg-${index}` }));

async function mountAt(name: RouteName, query: Record<string, string> = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'user', role: Role.user }
  });
  // 和 app 的路由表一样：数据列表的 props 带上查询参数 apply
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/resource-application',
        name: RouteName.resourceApplication,
        component: ResourceApplicationPage,
        props: route => ({
          section: 'applications',
          applyId: typeof route.query.apply === 'string' ? route.query.apply : null
        })
      },
      {
        path: '/resource-application/statistical-report',
        name: RouteName.resourceApplicationReports,
        component: ResourceApplicationPage,
        props: { section: 'reports' }
      }
    ]
  });
  await router.push({ name, query });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(() => h(RouterView), {
    global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]] },
    attachTo: document.body
  });
  await flushPromises();
  return { router, wrapper, queryClient };
}

// 表体每一行各列的文字
function rows() {
  return [...document.querySelectorAll('.el-table__body tr')].map(row =>
    [...row.querySelectorAll('td .cell')].map(cell => cell.textContent?.trim() ?? ''));
}

const headers = () => [...document.querySelectorAll('.el-table__header th')].map(cell => cell.textContent?.trim());

// 弹窗渲染在 body 下
const dialog = () => document.querySelector<HTMLElement>('.el-dialog');
const button = (root: ParentNode | null | undefined, text: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find(item => item.textContent?.trim() === text);
const rowOf = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.el-table__body tr')].find(row => row.textContent?.includes(name));

describe('ResourceApplicationPage', () => {
  it('数据列表：叫资源名称，没有申请人；都是"查看"，不通过和待审核的没有下载；统计任务不能查看', async () => {
    mockBackend();
    const { wrapper } = await mountAt(RouteName.resourceApplication);
    await vi.waitFor(() => expect(rows()).toHaveLength(5));

    expect(wrapper.findAll('h2').map(title => title.text())).toStrictEqual(['数据下载', '数据列表']);
    expect(wrapper.findAll('.el-form-item__label').map(label => label.text())).toEqual([
      '资源名称',
      '审核状态',
      '数据准备状态'
    ]);
    expect(wrapper.get('.el-form input').attributes('placeholder')).toBe('请输入资源名称');
    expect(headers()).toEqual(['序号', '资源名称', '行政区划', '申请时间', '审核状态', '数据准备状态', '操作']);
    expect(rows()).toEqual([
      ['1', '拆除未尽区', '江苏省南京市', '2026-10-28 11:29:36', '待审核', '', '查看'],
      ['2', '城镇村等用地', '江苏省', '2026-09-10 16:47:07', '审核通过', '正在处理', '查看下载'],
      ['3', '医疗机构面层', '江苏省', '2026-09-10 16:47:07', '审核通过', '处理完成', '查看下载'],
      ['4', '地类图斑', '江苏省', '2026-09-10 16:47:07', '审核不通过', '', '查看'],
      ['5', '统计任务', '', '', '审核通过', '未开始处理', '下载']
    ]);
  });

  it('查看待审核的申请：地址带上 apply，只读，没有审核意见和申请人；关闭时去掉 apply', async () => {
    mockBackend();
    const { router } = await mountAt(RouteName.resourceApplication);
    await vi.waitFor(() => expect(rows()).toHaveLength(5));

    button(rowOf('拆除未尽区'), '查看')?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.query.apply).toBe('apply-pending'));
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('审核进度'));

    expect(dialog()?.querySelector('.el-dialog__header')?.textContent).toContain('申请详情');
    expect(dialog()?.textContent).toContain('待审核');
    expect(dialog()?.textContent).toContain('申请处室');
    expect(dialog()?.textContent).not.toContain('申请人');
    expect(dialog()?.querySelector('.el-radio')).toBeNull();
    expect(button(dialog(), '提交审核')).toBeUndefined();

    dialog()?.querySelector<HTMLElement>('.el-dialog__headerbtn')?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.query.apply).toBeUndefined());
  });

  it('查看不通过的申请：显示审核结果和原因', async () => {
    mockBackend();
    await mountAt(RouteName.resourceApplication, { apply: 'apply-rejected' });
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('审核结果'));

    expect(dialog()?.textContent).toContain('审核不通过');
    expect(dialog()?.textContent).toContain('范围超出职责');
  });

  it('下载：准备完成的才能点；列表和弹窗都用 POST 读取后交给浏览器保存', async () => {
    const backend = mockBackend();
    const saved = stubSave();
    const success = vi.spyOn(ElMessage, 'success');
    await mountAt(RouteName.resourceApplication);
    await vi.waitFor(() => expect(rows()).toHaveLength(5));
    const downloads = [...document.querySelectorAll<HTMLButtonElement>('.el-table__body button')].filter(
      item => item.textContent?.trim() === '下载'
    );
    expect(downloads.map(item => item.disabled)).toEqual([true, false, true]);

    downloads[1]?.click();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('已交给浏览器下载'));
    expect(backend.downloads).toEqual(['POST apply-ready']);
    expect(saved).toEqual(['医疗机构面层.zip']);

    button(rowOf('医疗机构面层'), '查看')?.click();
    await vi.waitFor(() => expect(button(dialog(), '下载')).toBeDefined());
    button(dialog(), '下载')?.click();
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(backend.downloads).toEqual(['POST apply-ready', 'POST apply-ready']);
  });

  it('统计报表：不请求申请列表；处理成功的能下载；切回数据列表时再请求', async () => {
    const backend = mockBackend();
    const saved = stubSave();
    const { router, wrapper } = await mountAt(RouteName.resourceApplicationReports);
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(backend.list).toBe(0);
    expect(wrapper.findAll('h2').map(title => title.text())).toStrictEqual(['数据下载', '统计报表']);

    button(document, '下载')?.click();
    await vi.waitFor(() => expect(saved).toEqual(['基本统计报表_省级.zip']));
    expect(backend.downloads).toEqual(['GET 2117097190761029634']);

    await router.push({ name: RouteName.resourceApplication });
    await vi.waitFor(() => expect(backend.list).toBe(1));
  });

  it('未读数变多时重新读取列表和打开的详情；变少时不读，也不自己请求未读', async () => {
    const backend = mockBackend();
    const { queryClient } = await mountAt(RouteName.resourceApplication, { apply: 'apply-ready' });
    queryClient.setQueryData(messageKeys.unread(), unreadOf(2));
    await vi.waitFor(() => expect(rows()).toHaveLength(5));
    await vi.waitFor(() => expect(backend.detail).toBe(1));
    expect(backend.list).toBe(1);

    queryClient.setQueryData(messageKeys.unread(), unreadOf(1));
    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(backend.list).toBe(1);
    expect(backend.detail).toBe(1);

    queryClient.setQueryData(messageKeys.unread(), unreadOf(2));
    await vi.waitFor(() => expect(backend.list).toBe(2));
    await vi.waitFor(() => expect(backend.detail).toBe(2));
  });

  it('统计报表栏目：未读数变多时重新读取报表，不请求申请列表', async () => {
    const backend = mockBackend();
    const { queryClient } = await mountAt(RouteName.resourceApplicationReports);
    queryClient.setQueryData(messageKeys.unread(), unreadOf(1));
    await vi.waitFor(() => expect(backend.reports).toBe(1));

    queryClient.setQueryData(messageKeys.unread(), unreadOf(2));
    await vi.waitFor(() => expect(backend.reports).toBe(2));
    expect(backend.list).toBe(0);
  });
});
