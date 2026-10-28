import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { applicationPageResponse, pendingRecord } from '../test-data';
import { useApplicationList } from './useApplicationList';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface ListBody {
  applyName: string;
  status: string;
  taskStatus: string;
  pageNum: number;
  pageSize: number;
}

// 按 PageHelper 的规则返回（2026-10-27 实测）：越界的页码改成最后一页；没有数据时原样返回页码，pages 是 0
function pageHelper(body: ListBody, total: number) {
  const pages = Math.ceil(total / body.pageSize);
  const pageNum = total === 0 ? body.pageNum : Math.min(body.pageNum, pages);
  const count = Math.max(0, Math.min(body.pageSize, total - (pageNum - 1) * body.pageSize));
  const list = Array.from({ length: count }, (_, index) =>
    pendingRecord({ apply_id: `apply-${(pageNum - 1) * body.pageSize + index + 1}` }));
  return applicationPageResponse(list, { total, pageNum, pageSize: body.pageSize });
}

// 记下每次请求的正文；total 可以在用例中途改，模拟数据被删减
function mockList(initialTotal = 45) {
  const state = { total: initialTotal, bodies: [] as ListBody[] };
  server.use(
    mock.post('/backend/api/apply/list', async ({ request }) => {
      const body = (await request.json()) as ListBody;
      state.bodies.push(body);
      return HttpResponse.json(pageHelper(body, state.total));
    })
  );
  return state;
}

// 请求到达后挂起，调用 release 才返回，用来观察请求进行中的状态
function holdList() {
  const bodies: ListBody[] = [];
  const held: (() => void)[] = [];
  server.use(
    mock.post('/backend/api/apply/list', async ({ request }) => {
      const body = (await request.json()) as ListBody;
      bodies.push(body);
      await new Promise<void>(resolve => {
        held.push(resolve);
      });
      return HttpResponse.json(pageHelper(body, 45));
    })
  );
  const release = () => {
    for (const resolve of held.splice(0)) {
      resolve();
    }
  };
  return { bodies, release };
}

let list: ReturnType<typeof useApplicationList>;

const Host = defineComponent(() => {
  list = useApplicationList();
  return () => null;
});

function mountHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
}

const firstId = () => list.applications.value[0]?.id;

describe('useApplicationList', () => {
  it('首次请求第 1 页、每页 20 条，不带筛选条件', async () => {
    const backend = mockList();
    mountHost();

    await vi.waitFor(() => expect(list.applications.value).toHaveLength(20));
    expect(backend.bodies).toEqual([{ applyName: '', status: '', taskStatus: '', pageNum: 1, pageSize: 20 }]);
    expect(list.total.value).toBe(45);
  });

  it('编辑筛选表单不发请求，点查询才生效：名称去掉首尾空格，回到第 1 页', async () => {
    const backend = mockList();
    mountHost();
    await vi.waitFor(() => expect(firstId()).toBe('apply-1'));
    list.pageNum.value = 2;
    await vi.waitFor(() => expect(firstId()).toBe('apply-21'));

    list.filterForm.name = '  拆除 ';
    list.filterForm.status = 'pending';
    list.filterForm.prepare = 'timeout';
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(backend.bodies).toHaveLength(2);

    list.search();
    await vi.waitFor(() => expect(backend.bodies).toHaveLength(3));
    expect(backend.bodies[2]).toEqual({ applyName: '拆除', status: 'pending', taskStatus: 'timeout', pageNum: 1, pageSize: 20 });
    expect(list.pageNum.value).toBe(1);
  });

  it('重置清空表单和已生效的条件', async () => {
    const backend = mockList();
    mountHost();
    list.filterForm.name = '拆除';
    list.search();
    await vi.waitFor(() => expect(backend.bodies.at(-1)?.applyName).toBe('拆除'));

    list.resetFilters();
    await vi.waitFor(() => expect(backend.bodies.at(-1)?.applyName).toBe(''));
    expect(list.filterForm).toEqual({ name: '', status: '', prepare: '' });
  });

  it('改每页条数时回到第 1 页', async () => {
    const backend = mockList();
    mountHost();
    list.pageNum.value = 3;
    await vi.waitFor(() => expect(firstId()).toBe('apply-41'));

    list.changePageSize(50);
    await vi.waitFor(() => expect(backend.bodies.at(-1)).toMatchObject({ pageNum: 1, pageSize: 50 }));
    expect(list.pageNum.value).toBe(1);
  });

  it('页码越界时跟着后端改到最后一页，显示后端返回的那一页', async () => {
    const backend = mockList();
    mountHost();
    list.pageNum.value = 3;
    await vi.waitFor(() => expect(firstId()).toBe('apply-41'));

    // 第 3 页的数据被删掉了：后端把第 3 页改成第 2 页
    backend.total = 30;
    void list.refresh();
    await vi.waitFor(() => expect(list.pageNum.value).toBe(2));
    expect(firstId()).toBe('apply-21');
    expect(list.total.value).toBe(30);
  });

  it('没有数据时 pages 是 0，回到第 1 页', async () => {
    const backend = mockList();
    mountHost();
    list.pageNum.value = 3;
    await vi.waitFor(() => expect(firstId()).toBe('apply-41'));

    backend.total = 0;
    void list.refresh();
    await vi.waitFor(() => expect(list.pageNum.value).toBe(1));
    expect(list.applications.value).toEqual([]);
    expect(list.total.value).toBe(0);
  });

  it('请求出错时不改页码', async () => {
    mockList();
    mountHost();
    await vi.waitFor(() => expect(firstId()).toBe('apply-1'));
    server.use(mock.post('/backend/api/apply/list', () => HttpResponse.json({ success: false, code: 500, msg: '系统异常' })));

    list.pageNum.value = 2;
    await vi.waitFor(() => expect(list.isError.value).toBe(true));
    expect(list.pageNum.value).toBe(2);
  });

  it('首次加载是 initialLoading；翻页时保留上一页的数据，是 refreshing', async () => {
    const { bodies, release } = holdList();
    mountHost();
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(list.initialLoading.value).toBe(true);
    expect(list.refreshing.value).toBe(false);
    release();
    await vi.waitFor(() => expect(firstId()).toBe('apply-1'));

    list.pageNum.value = 2;
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(firstId()).toBe('apply-1');
    expect(list.initialLoading.value).toBe(false);
    expect(list.refreshing.value).toBe(true);

    release();
    await vi.waitFor(() => expect(firstId()).toBe('apply-21'));
    expect(list.refreshing.value).toBe(false);
  });

  it('条件没变时点查询也重新请求，请求期间 refreshing 为 true', async () => {
    const { bodies, release } = holdList();
    mountHost();
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    release();
    await vi.waitFor(() => expect(firstId()).toBe('apply-1'));

    list.search();
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(list.refreshing.value).toBe(true);
    release();
    await vi.waitFor(() => expect(list.refreshing.value).toBe(false));
  });
});
