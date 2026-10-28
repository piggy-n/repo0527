import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import {
  applicationPageResponse,
  approvedRecord,
  pendingRecord,
  tableRecord
} from '@/features/data-application/test-data';
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
  document.body.innerHTML = '';
});
afterAll(() => server.close());

// 一页里有待审核、准备中的、统计任务各一条；记下请求次数
function mockList() {
  const state = { requests: 0 };
  server.use(
    mock.post('/backend/api/apply/list', () => {
      state.requests += 1;
      const list = [pendingRecord(), approvedRecord({ storage_status: 'processing' }), tableRecord()];
      return HttpResponse.json(applicationPageResponse(list));
    })
  );
  return state;
}

async function mountAt(name: RouteName) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/system-management',
        name: RouteName.systemManagement,
        component: SystemManagementPage,
        props: { section: 'audit' }
      },
      {
        path: '/system-management/statistical-report',
        name: RouteName.systemManagementReports,
        component: SystemManagementPage,
        props: { section: 'reports' }
      }
    ]
  });
  await router.push({ name });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(() => h(RouterView), {
    global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
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

describe('SystemManagementPage', () => {
  it('资源审核：标题、筛选栏和表格；没有值的单元格留空，由全局样式显示"-"', async () => {
    mockList();
    const { wrapper } = await mountAt(RouteName.systemManagement);
    await vi.waitFor(() => expect(rows()).toHaveLength(3));

    expect(wrapper.find('h2').text()).toBe('资源审核');
    expect(wrapper.findAll('.el-form-item__label').map(label => label.text())).toEqual([
      '数据名称',
      '审核状态',
      '数据准备状态'
    ]);
    expect(rows()).toEqual([
      ['1', '拆除未尽区', '', '江苏省南京市', '2026-10-28 11:29:36', '待审核', ''],
      ['2', '城镇村等用地', '王立', '江苏省', '2026-09-10 16:47:07', '审核通过', '正在处理'],
      ['3', '', '王立', '', '', '统计任务', '未开始处理']
    ]);
  });

  it('统计报表栏目不请求申请列表；切回资源审核时再请求', async () => {
    const backend = mockList();
    const { router } = await mountAt(RouteName.systemManagementReports);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(backend.requests).toBe(0);
    expect(document.body.textContent).toContain('统计报表：迁移中');

    await router.push({ name: RouteName.systemManagement });
    await vi.waitFor(() => expect(backend.requests).toBe(1));
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
    await wrapper.findAll('button').find(button => button.text() === '重试')?.trigger('click');
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(requests).toBe(2);
  });
});
