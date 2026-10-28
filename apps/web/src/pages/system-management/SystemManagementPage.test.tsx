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
import { reportPageResponse, reportRecord } from '@/features/statistics-report/test-data';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { RouteName } from '@/shared/router/route-names';
import { SystemManagementPage } from './SystemManagementPage';

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

type RawRecord = Record<string, unknown>;

// 申请：待审核、准备中、准备完成、统计任务各一条，审核会改掉待审核那条的状态；报表：处理完成、处理中各一条。
// 记下列表、详情、报表的请求次数，审核的参数和下载的请求
function mockBackend() {
  const records: RawRecord[] = [
    pendingRecord(),
    approvedRecord({ storage_status: 'processing' }),
    approvedRecord({ apply_id: 'apply-ready', apply_name: '医疗机构面层', storage_status: 'success' }),
    tableRecord()
  ];
  const reports = [reportRecord(), reportRecord({ id: 'report-2', name: '汇总统计报表_市级', status: 'processing' })];
  const state = { list: 0, detail: 0, reports: 0, audits: [] as Record<string, string>[], downloads: [] as string[] };
  server.use(
    mock.post('/backend/api/apply/list', () => {
      state.list += 1;
      return HttpResponse.json(applicationPageResponse(records));
    }),
    mock.get('/backend/api/apply/:id', ({ params }) => {
      state.detail += 1;
      return HttpResponse.json(envelope(records.find(record => record.apply_id === params.id) ?? null));
    }),
    mock.post('/backend/api/apply/status/:id', ({ params, request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      state.audits.push({ id: String(params.id), ...query });
      const record = records.find(item => item.apply_id === params.id);
      if (record) {
        record.status = query.status;
        record.remark = query.reason;
      }
      return HttpResponse.json(envelope(null));
    }),
    mock.post('/backend/statistics/page', () => {
      state.reports += 1;
      return HttpResponse.json(reportPageResponse(reports));
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
  // 只补上保存要用的两个静态方法，new URL 照常可用（接口模拟要用）
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

async function mountAt(name: RouteName, query: Record<string, string> = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  // 和 app 的路由表一样：资源审核的 props 带上查询参数 apply
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/system-management',
        name: RouteName.systemManagement,
        component: SystemManagementPage,
        props: route => ({
          section: 'audit',
          applyId: typeof route.query.apply === 'string' ? route.query.apply : null
        })
      },
      {
        path: '/system-management/statistical-report',
        name: RouteName.systemManagementReports,
        component: SystemManagementPage,
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
  return { router, wrapper };
}

// 表体每一行各列的文字
function rows() {
  return [...document.querySelectorAll('.el-table__body tr')].map(row =>
    [...row.querySelectorAll('td .cell')].map(cell => cell.textContent?.trim() ?? ''));
}

// 弹窗渲染在 body 下
const dialog = () => document.querySelector<HTMLElement>('.el-dialog');
const dialogOpen = () => {
  const overlay = dialog()?.closest<HTMLElement>('.el-overlay');
  return overlay !== null && overlay !== undefined && overlay.style.display !== 'none';
};
const button = (root: ParentNode | null | undefined, text: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find(item => item.textContent?.trim() === text);

describe('SystemManagementPage', () => {
  it('资源审核：标题、筛选栏和表格；没有值的单元格留空，由全局样式显示"-"；统计任务不能查看', async () => {
    mockBackend();
    const { wrapper } = await mountAt(RouteName.systemManagement);
    await vi.waitFor(() => expect(rows()).toHaveLength(4));

    expect(wrapper.find('h2').text()).toBe('资源审核');
    expect(wrapper.findAll('.el-form-item__label').map(label => label.text())).toEqual([
      '数据名称',
      '审核状态',
      '数据准备状态'
    ]);
    expect(rows()).toEqual([
      ['1', '拆除未尽区', '', '江苏省南京市', '2026-10-28 11:29:36', '待审核', '', '审核'],
      ['2', '城镇村等用地', '王立', '江苏省', '2026-09-10 16:47:07', '审核通过', '正在处理', '查看下载'],
      ['3', '医疗机构面层', '王立', '江苏省', '2026-09-10 16:47:07', '审核通过', '处理完成', '查看下载'],
      ['4', '', '王立', '', '', '统计任务', '未开始处理', '下载']
    ]);
  });

  it('下载：准备完成的才能点，用 POST 读取后交给浏览器保存；没准备好的置灰', async () => {
    const backend = mockBackend();
    const saved = stubSave();
    const success = vi.spyOn(ElMessage, 'success');
    await mountAt(RouteName.systemManagement);
    await vi.waitFor(() => expect(rows()).toHaveLength(4));
    const downloadButtons = [...document.querySelectorAll<HTMLButtonElement>('.el-table__body button')].filter(
      item => item.textContent?.trim() === '下载'
    );
    expect(downloadButtons.map(item => item.disabled)).toEqual([true, false, true]);

    downloadButtons[1]?.click();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('已交给浏览器下载'));
    expect(backend.downloads).toEqual(['POST apply-ready']);
    expect(saved).toEqual(['医疗机构面层.zip']);
  });

  it('查看准备完成的申请：弹窗里也能下载', async () => {
    const backend = mockBackend();
    const saved = stubSave();
    await mountAt(RouteName.systemManagement, { apply: 'apply-ready' });
    await vi.waitFor(() => expect(button(dialog(), '下载')).toBeDefined());

    button(dialog(), '下载')?.click();
    await vi.waitFor(() => expect(saved).toEqual(['医疗机构面层.zip']));
    expect(backend.downloads).toEqual(['POST apply-ready']);
  });

  it('统计报表：不请求申请列表；表格和下载，处理完成的才能下载；切回资源审核时再请求申请列表', async () => {
    const backend = mockBackend();
    const saved = stubSave();
    const { router, wrapper } = await mountAt(RouteName.systemManagementReports);
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    expect(backend.list).toBe(0);
    expect(wrapper.find('h2').text()).toBe('统计报表');
    expect(rows()).toEqual([
      ['1', '2024', '基本统计报表_省级', '2026-10-14 14:20:00', '2026-10-14 14:23:45', '处理完成', '下载'],
      ['2', '2024', '汇总统计报表_市级', '2026-10-14 14:20:00', '2026-10-14 14:23:45', '正在处理', '下载']
    ]);
    const downloadButtons = [...document.querySelectorAll<HTMLButtonElement>('.el-table__body button')];
    expect(downloadButtons.map(item => item.disabled)).toEqual([false, true]);

    downloadButtons[0]?.click();
    await vi.waitFor(() => expect(saved).toEqual(['基本统计报表_省级.zip']));
    expect(backend.downloads).toEqual(['GET report-1']);

    await router.push({ name: RouteName.systemManagement });
    await vi.waitFor(() => expect(backend.list).toBe(1));
  });

  it('列表加载失败时显示重试，点了重新请求', async () => {
    let fail = true;
    let requests = 0;
    server.use(
      mock.post('/backend/api/apply/list', () => {
        requests += 1;
        if (fail) {
          return HttpResponse.json({ success: false, code: 500, msg: '系统异常' });
        }
        return HttpResponse.json(applicationPageResponse([pendingRecord()]));
      })
    );
    const { wrapper } = await mountAt(RouteName.systemManagement);
    await vi.waitFor(() => expect(wrapper.text()).toContain('加载失败'));

    fail = false;
    await wrapper.findAll('button').find(item => item.text() === '重试')?.trigger('click');
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(requests).toBe(2);
  });

  it('点"审核"：地址带上 apply，弹窗先用列表里的这一行显示，同时再读一次详情', async () => {
    mockBackend();
    // 详情接口挂起：弹窗里有内容只能是列表里的那一行
    const details: (() => void)[] = [];
    server.use(
      mock.get('/backend/api/apply/:id', async () => {
        await new Promise<void>(resolve => {
          details.push(resolve);
        });
        return HttpResponse.json(envelope(pendingRecord()));
      })
    );
    const { router, wrapper } = await mountAt(RouteName.systemManagement);
    await vi.waitFor(() => expect(rows()).toHaveLength(4));

    await wrapper.findAll('.el-table__body button').find(item => item.text() === '审核')?.trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.query.apply).toBe('apply-pending'));
    await vi.waitFor(() => expect(details).toHaveLength(1));
    expect(dialogOpen()).toBe(true);
    expect(dialog()?.querySelector('.el-dialog__header')?.textContent).toContain('审核申请');
    expect(dialog()?.textContent).toContain('地类图斑');
    expect(dialog()?.textContent).toContain('GDB');
    details[0]?.();
  });

  it('不通过时必须填原因；提交后提示、关闭弹窗、去掉 apply，列表重新读取', async () => {
    const backend = mockBackend();
    const success = vi.spyOn(ElMessage, 'success');
    const { router } = await mountAt(RouteName.systemManagement, { apply: 'apply-pending' });
    await vi.waitFor(() => expect(button(dialog(), '提交审核')).toBeDefined());

    [...(dialog()?.querySelectorAll<HTMLElement>('.el-radio') ?? [])][1]?.click();
    await flushPromises();
    button(dialog(), '提交审核')?.click();
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('请填写不通过的原因'));
    expect(backend.audits).toEqual([]);

    const reason = dialog()?.querySelector('textarea');
    if (!reason) {
      throw new Error('没有原因的输入框');
    }
    reason.value = '  用途不明确 ';
    reason.dispatchEvent(new Event('input'));
    const listBefore = backend.list;
    button(dialog(), '提交审核')?.click();

    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('已退回申请'));
    expect(backend.audits).toEqual([{ id: 'apply-pending', status: 'rejected', reason: '用途不明确' }]);
    await vi.waitFor(() => expect(router.currentRoute.value.query.apply).toBeUndefined());
    await vi.waitFor(() => expect(dialogOpen()).toBe(false));
    expect(backend.list).toBeGreaterThan(listBefore);
    await vi.waitFor(() => expect(rows()[0]?.[5]).toBe('审核不通过'));
  });

  it('已经审核过的申请只查看：显示审核结果，没有底栏；关闭时去掉 apply', async () => {
    mockBackend();
    const { router } = await mountAt(RouteName.systemManagement, { apply: 'apply-approved' });
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('审核结果'));

    expect(dialog()?.querySelector('.el-dialog__header')?.textContent).toContain('申请详情');
    expect(dialog()?.textContent).toContain('正在处理');
    expect(button(dialog(), '提交审核')).toBeUndefined();

    dialog()?.querySelector<HTMLElement>('.el-dialog__headerbtn')?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.query.apply).toBeUndefined());
  });

  it('从消息打开不存在的申请：说明不存在，没有底栏', async () => {
    mockBackend();
    await mountAt(RouteName.systemManagement, { apply: 'missing' });
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('申请不存在或已被删除'));
    expect(button(dialog(), '提交审核')).toBeUndefined();
  });
});
