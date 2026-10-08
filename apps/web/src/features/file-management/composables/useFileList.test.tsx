import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_CATEGORY_ID } from '../categories';
import { filePageResponse } from '../test-data';
import { useFileList } from './useFileList';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// 记录每次请求的查询参数；totalElements 决定返回的总页数
function mockFilePage(totalElements = 45) {
  const requests: Record<string, string>[] = [];
  server.use(
    mock.get('/backend/file/page', ({ request }) => {
      const params = Object.fromEntries(new URL(request.url).searchParams);
      requests.push(params);
      const { categoryId, pageNo, pageSize } = params;
      return HttpResponse.json(
        filePageResponse({ categoryId, pageNo: Number(pageNo), pageSize: Number(pageSize), totalElements })
      );
    })
  );
  return requests;
}

let list: ReturnType<typeof useFileList>;

const Host = defineComponent({
  setup() {
    list = useFileList();
    return () => null;
  }
});

function mountHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
}

describe('useFileList', () => {
  it('首次请求默认分类的第 1 页，每页 20 条，不带筛选参数', async () => {
    const requests = mockFilePage();
    mountHost();

    await vi.waitFor(() => expect(list.files.value).toHaveLength(20));
    expect(requests).toEqual([{ categoryId: DEFAULT_CATEGORY_ID, pageNo: '1', pageSize: '20' }]);
    expect(list.total.value).toBe(45);
  });

  it('换分类时回到第 1 页', async () => {
    const requests = mockFilePage();
    mountHost();
    list.pageNo.value = 3;
    await vi.waitFor(() => expect(requests.at(-1)?.pageNo).toBe('3'));

    list.selectCategory('policy-law-local');

    await vi.waitFor(() => expect(requests.at(-1)).toEqual({ categoryId: 'policy-law-local', pageNo: '1', pageSize: '20' }));
  });

  it('编辑筛选表单不发请求，点查询才生效：名称去掉首尾空格，空的条件不传，回到第 1 页', async () => {
    const requests = mockFilePage();
    mountHost();
    list.pageNo.value = 2;
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    list.filterForm.name = '  政区 ';
    list.filterForm.tag = '森林';
    // 断言"没有发请求"要多等一会儿：Vue Query 发请求比 nextTick 晚好几轮
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(requests).toHaveLength(2);

    list.search();

    await vi.waitFor(() =>
      expect(requests.at(-1)).toEqual({
        categoryId: DEFAULT_CATEGORY_ID,
        pageNo: '1',
        pageSize: '20',
        name: '政区',
        tag: '森林'
      })
    );
  });

  it('重置清空表单和已生效的条件', async () => {
    const requests = mockFilePage();
    mountHost();
    list.filterForm.year = '2026';
    list.search();
    await vi.waitFor(() => expect(requests.at(-1)?.year).toBe('2026'));

    list.resetFilters();

    expect(list.filterForm).toEqual({ name: '', year: '', tag: '' });
    await vi.waitFor(() => expect(requests.at(-1)).toEqual({ categoryId: DEFAULT_CATEGORY_ID, pageNo: '1', pageSize: '20' }));
  });

  it('改每页条数时回到第 1 页', async () => {
    // 200 条：每页 50 条时仍有 4 页，第 2 页有效，不会被越界修正拉回第 1 页
    const requests = mockFilePage(200);
    mountHost();
    list.pageNo.value = 2;
    await vi.waitFor(() => expect(requests.at(-1)?.pageNo).toBe('2'));

    list.changePageSize(50);

    await vi.waitFor(() => expect(requests.at(-1)).toMatchObject({ pageNo: '1', pageSize: '50' }));
  });

  it('当前页超过总页数时（例如删掉了最后一页的最后一条）改到最后一页', async () => {
    const requests = mockFilePage(41);
    mountHost();
    list.pageNo.value = 3;
    await vi.waitFor(() => expect(requests.at(-1)?.pageNo).toBe('3'));

    // 删除后只剩 40 条，共 2 页；后端对第 3 页返回第 2 页的数据，页码仍是 3
    server.resetHandlers();
    const after = mockFilePage(40);
    void list.refetch();

    await vi.waitFor(() => expect(list.pageNo.value).toBe(2));
    await vi.waitFor(() => expect(after.at(-1)?.pageNo).toBe('2'));
  });

  it('请求出错时不改页码', async () => {
    const requests = mockFilePage();
    mountHost();
    list.pageNo.value = 2;
    await vi.waitFor(() => expect(requests.at(-1)?.pageNo).toBe('2'));

    server.resetHandlers();
    server.use(mock.get('/backend/file/page', () => HttpResponse.json({ code: 500, msg: '服务异常', data: null })));
    list.pageNo.value = 3;

    await vi.waitFor(() => expect(list.isError.value).toBe(true));
    expect(list.pageNo.value).toBe(3);
  });
});
