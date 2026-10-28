import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { useSystemList } from './useSystemList';

const server = setupServer();
const cleanups: (() => void)[] = [];
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  server.resetHandlers();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let list!: ReturnType<typeof useSystemList>;
  const wrapper = mount(
    defineComponent(() => {
      list = useSystemList('audit');
      return () => null;
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } }
  );
  cleanups.push(() => {
    wrapper.unmount();
    client.clear();
  });
  return list;
}

function page(total = 45) {
  return HttpResponse.json({
    code: 200,
    data: {
      list: [{ apply_id: 'one', apply_name: '成果', status: 'pending' }],
      total,
      pageNum: 1,
      pageSize: 20,
      pages: Math.ceil(total / 20)
    }
  });
}

describe('系统管理筛选与分页', () => {
  it('默认每页 20；查询才应用表单，重置和改变条数回第一页', async () => {
    const bodies: unknown[] = [];
    server.use(mock.post('/backend/api/apply/list', async ({ request }) => {
      bodies.push(await request.json());
      return page();
    }));
    const list = setup();
    await vi.waitFor(() => expect(list.total.value).toBe(45));
    expect(bodies[0]).toEqual({ pageNum: 1, pageSize: 20, applyName: '', status: '', taskStatus: '' });
    list.pageNum.value = 2;
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    list.form.name = ' 土地 ';
    list.form.status = 'pending';
    list.search();
    await vi.waitFor(() => expect(bodies.at(-1)).toMatchObject({ pageNum: 1, applyName: '土地', status: 'pending' }));
    list.reset();
    await vi.waitFor(() => expect(bodies.at(-1)).toMatchObject({ applyName: '', status: '' }));
    list.pageNum.value = 2;
    list.changePageSize(50);
    await vi.waitFor(() => expect(bodies.at(-1)).toMatchObject({ pageNum: 1, pageSize: 50 }));
  });

  it('翻页失败保留该条件总数；换条件失败不沿用旧总数', async () => {
    const names: string[] = [];
    server.use(mock.post('/backend/api/apply/list', async ({ request }) => {
      const body = await request.json() as { pageNum: number; applyName: string };
      names.push(body.applyName);
      return body.pageNum === 1 && body.applyName === '' ? page() : HttpResponse.json({ code: 500, msg: '加载失败' });
    }));
    const list = setup();
    await vi.waitFor(() => expect(list.total.value).toBe(45));
    list.pageNum.value = 2;
    await vi.waitFor(() => expect(list.isError.value).toBe(true));
    expect(list.total.value).toBe(45);
    expect(list.pageNum.value).toBe(2);
    list.form.name = '新条件';
    list.search();
    await vi.waitFor(() => expect(names.at(-1)).toBe('新条件'));
    await vi.waitFor(() => expect(list.isError.value).toBe(true));
    expect(list.total.value).toBe(0);
  });

  it('刷新后页码越界时回到最后一页，不因旧占位数据提前跳页', async () => {
    server.use(mock.post('/backend/api/apply/list', () => page()));
    const list = setup();
    await vi.waitFor(() => expect(list.total.value).toBe(45));
    list.pageNum.value = 3;
    await vi.waitFor(() => expect(list.refreshing.value).toBe(false));
    server.use(mock.post('/backend/api/apply/list', () => page(21)));
    await list.refresh();
    await vi.waitFor(() => expect(list.pageNum.value).toBe(2));
    expect(list.total.value).toBe(21);
  });
});
