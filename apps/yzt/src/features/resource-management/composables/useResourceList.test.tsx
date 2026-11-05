import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { configureHttp } from '@/shared/http/configure';
import type { ResourcePageParams } from '../api';
import { resourceManagementKeys } from '../queries';
import { resourceDirectoryResponse, resourcePageResponse, resourceYearsResponse } from '../test-data';
import { useResourceList } from './useResourceList';

const server = setupServer();
const clients: QueryClient[] = [];
const releases = new Set<() => void>();
let tree = resourceDirectoryResponse();
let total = 48;
let requests: ResourcePageParams[];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  tree = resourceDirectoryResponse();
  total = 48;
  requests = [];
  server.use(
    mock.get('/backend/resource-center/tree', () => HttpResponse.json(tree)),
    mock.get('/backend/resource-center/year/list', () => HttpResponse.json(resourceYearsResponse())),
    mock.post('/backend/resource-management/layer/page', async ({ request }) => {
      const params = await request.json() as ResourcePageParams;
      requests.push(params);
      return HttpResponse.json(resourcePageResponse({ ...params, total }));
    })
  );
});
afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  releases.forEach(release => release());
  releases.clear();
  server.resetHandlers();
  configureHttp({});
});
afterAll(() => server.close());

function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(client);
  return client;
}

function mountList(queryClient = createClient()) {
  let list!: ReturnType<typeof useResourceList>;
  const host = defineComponent(() => {
    list = useResourceList();
    return () => null;
  });
  const wrapper = mount(host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  return { list, queryClient, wrapper };
}

async function loadList(queryClient?: QueryClient) {
  const host = mountList(queryClient);
  await vi.waitFor(() => expect(host.list.resources.value).toHaveLength(20));
  return host;
}

interface HeldPage {
  params: ResourcePageParams;
  reply: (body?: JsonBodyType) => void;
  returned: boolean;
}

/** 按请求控制返回顺序，不依赖固定延时；结束时释放未返回的 MSW 处理函数 */
function holdPages() {
  const held: HeldPage[] = [];
  server.use(mock.post('/backend/resource-management/layer/page', async ({ request }) => {
    const params = await request.json() as ResourcePageParams;
    requests.push(params);
    const response = resourcePageResponse({ ...params, total });
    let entry!: HeldPage;
    const body = await new Promise<JsonBodyType>(resolve => {
      const cleanup = () => resolve(response);
      releases.add(cleanup);
      entry = { params, returned: false, reply: (value = response) => {
        releases.delete(cleanup);
        resolve(value);
      } };
      held.push(entry);
    });
    entry.returned = true;
    return HttpResponse.json(body);
  }));
  return held;
}

describe('useResourceList 的目录、年份与筛选', () => {
  it('目录返回前不请求列表，默认选择第一个二级目录；年份独立读取', async () => {
    let releaseTree!: () => void;
    server.use(mock.get('/backend/resource-center/tree', async () => {
      await new Promise<void>(resolve => {
        releaseTree = resolve;
        releases.add(resolve);
      });
      return HttpResponse.json(tree);
    }));
    const { list } = mountList();
    await vi.waitFor(() => expect(list.yearsQuery.data.value).toHaveLength(3));
    expect(requests).toEqual([]);
    expect(list.directoryId.value).toBeNull();
    releaseTree();

    await vi.waitFor(() => expect(list.resources.value).toHaveLength(20));
    expect(requests).toEqual([{ resource: '土地资源', pageNum: 1, pageSize: 20 }]);
    expect(list.directoryId.value).toBe('land');
    expect(list.total.value).toBe(48);
  });

  it('只有顶层空分组时不查询列表，也不允许手动刷新发出无目录请求', async () => {
    tree.data = tree.data.filter(node => node.id === 'three');
    const { list } = mountList();
    await vi.waitFor(() => expect(list.directoryQuery.isSuccess.value).toBe(true));
    list.selectDirectory('three');
    await list.refresh();
    expect(list.directoryId.value).toBeNull();
    expect(list.resources.value).toEqual([]);
    expect(list.total.value).toBe(0);
    expect(list.initialLoading.value).toBe(false);
    expect(requests).toEqual([]);
  });

  it('目录加载失败不发列表，重试成功后自动选择；年份失败不阻止列表', async () => {
    server.use(
      mock.get('/backend/resource-center/tree', () => HttpResponse.json({ code: 500, msg: '目录失败' })),
      mock.get('/backend/resource-center/year/list', () => HttpResponse.json({ code: 500, msg: '年份失败' }))
    );
    const { list } = mountList();
    await vi.waitFor(() => expect(list.directoryQuery.isError.value).toBe(true));
    await vi.waitFor(() => expect(list.yearsQuery.isError.value).toBe(true));
    expect(requests).toEqual([]);

    server.use(mock.get('/backend/resource-center/tree', () => HttpResponse.json(tree)));
    await list.directoryQuery.refetch();
    await vi.waitFor(() => expect(list.resources.value).toHaveLength(20));
    expect(list.yearsQuery.data.value).toBeUndefined();
    expect(list.directoryId.value).toBe('land');
  });

  it('表单草稿不请求，提交才裁剪名称、应用年份并回到首页；重置移除空筛选', async () => {
    const { list } = await loadList();
    list.pageNum.value = 2;
    await vi.waitFor(() => expect(list.resources.value[0]?.id).toBe('土地资源-21'));
    list.filterForm.name = '  地类图斑  ';
    list.filterForm.year = '2024';
    await flushPromises();
    expect(requests).toHaveLength(2);
    list.search();
    await vi.waitFor(() => expect(requests.at(-1)).toEqual({
      resource: '土地资源', pageNum: 1, pageSize: 20, layerName: '地类图斑', year: '2024'
    }));
    list.resetFilters();
    await vi.waitFor(() => expect(requests.at(-1)).toEqual({ resource: '土地资源', pageNum: 1, pageSize: 20 }));
    expect(list.filterForm).toEqual({ name: '', year: '' });
  });

  it('切换目录重置草稿、已提交筛选和页码，但保留每页条数；不选择顶层或不存在的节点', async () => {
    const { list } = await loadList();
    list.changePageSize(5);
    list.filterForm.name = '图斑';
    list.filterForm.year = '2024';
    list.search();
    list.pageNum.value = 2;
    await vi.waitFor(() => expect(requests.at(-1)?.pageNum).toBe(2));
    list.selectDirectory('water');
    expect(list.resources.value).toEqual([]);
    expect(list.total.value).toBe(0);
    await vi.waitFor(() => expect(requests.at(-1)).toEqual({ resource: '水资源', pageNum: 1, pageSize: 5 }));
    expect(list.filterForm).toEqual({ name: '', year: '' });
    list.selectDirectory('base');
    list.selectDirectory('missing');
    expect(list.directoryId.value).toBe('water');
  });

  it('当前目录重命名后使用新名称并重置；其他目录变化不重置当前条件', async () => {
    const { list } = await loadList();
    list.filterForm.name = '图斑';
    list.search();
    list.pageNum.value = 2;
    await vi.waitFor(() => expect(requests.at(-1)?.pageNum).toBe(2));
    const other = tree.data[0]?.children?.[1];
    if (other) {
      other.name = '新水资源';
    }
    await list.directoryQuery.refetch();
    expect(list.pageNum.value).toBe(2);
    expect(list.filterForm.name).toBe('图斑');
    const selected = tree.data[0]?.children?.[0];
    if (selected) {
      selected.name = '新土地资源';
    }
    await list.directoryQuery.refetch();
    await vi.waitFor(() => expect(requests.at(-1)).toEqual({ resource: '新土地资源', pageNum: 1, pageSize: 20 }));
    expect(list.directoryId.value).toBe('land');
    expect(list.filterForm).toEqual({ name: '', year: '' });
  });

  it('当前目录消失后选择第一个有效目录，全部消失后停止列表查询', async () => {
    const { list } = await loadList();
    const base = tree.data[0];
    if (base) {
      base.children = base.children?.filter(node => node.id !== 'land') ?? null;
    }
    await list.directoryQuery.refetch();
    await vi.waitFor(() => expect(list.resources.value[0]?.resourceName).toBe('水资源'));
    expect(list.directoryId.value).toBe('water');
    const count = requests.length;
    tree.data = [];
    await list.directoryQuery.refetch();
    await flushPromises();
    expect(list.directoryId.value).toBeNull();
    expect(list.resources.value).toEqual([]);
    expect(list.total.value).toBe(0);
    expect(requests).toHaveLength(count);
  });

  it('更改每页条数回到首页，同一目录再次选择不清空条件', async () => {
    const { list } = await loadList();
    list.pageNum.value = 2;
    await vi.waitFor(() => expect(requests.at(-1)?.pageNum).toBe(2));
    list.filterForm.name = '未提交草稿';
    list.selectDirectory('land');
    expect(list.pageNum.value).toBe(2);
    expect(list.filterForm.name).toBe('未提交草稿');
    list.changePageSize(10);
    await vi.waitFor(() => expect(requests.at(-1)).toEqual({ resource: '土地资源', pageNum: 1, pageSize: 10 }));
  });
});

describe('useResourceList 的缓存、加载与页码', () => {
  it('首次加载与分页占位使用不同状态；跨目录立即隐藏旧记录', async () => {
    const held = holdPages();
    const { list } = mountList();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(list.initialLoading.value).toBe(true);
    expect(list.refreshing.value).toBe(false);
    held[0]?.reply();
    await vi.waitFor(() => expect(list.resources.value).toHaveLength(20));
    list.pageNum.value = 2;
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(list.resources.value[0]?.id).toBe('土地资源-1');
    expect(list.initialLoading.value).toBe(false);
    expect(list.refreshing.value).toBe(true);
    held[1]?.reply();
    await vi.waitFor(() => expect(list.resources.value[0]?.id).toBe('土地资源-21'));
    list.selectDirectory('water');
    expect(list.resources.value).toEqual([]);
    await vi.waitFor(() => expect(held).toHaveLength(3));
    expect(list.initialLoading.value).toBe(true);
    expect(list.refreshing.value).toBe(false);
  });

  it('相同查询主动刷新；连续点击时等待最后一次，旧刷新不会提前关闭遮罩', async () => {
    const { list } = await loadList();
    const held = holdPages();
    list.search();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(list.refreshing.value).toBe(true);
    list.search();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[0]?.reply();
    await flushPromises();
    expect(list.refreshing.value).toBe(true);
    held[1]?.reply();
    await vi.waitFor(() => expect(list.refreshing.value).toBe(false));
  });

  it('翻页失败保留当前页和已知总数；重试期间显示首次加载，成功后恢复记录', async () => {
    const { list } = await loadList();
    const held = holdPages();
    list.pageNum.value = 3;
    await vi.waitFor(() => expect(held).toHaveLength(1));
    held[0]?.reply({ code: 500, msg: '分页失败' });
    await vi.waitFor(() => expect(list.isError.value).toBe(true));
    expect(list.pageNum.value).toBe(3);
    expect(list.total.value).toBe(48);
    expect(list.resources.value).toEqual([]);
    const pending = list.refresh();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(list.initialLoading.value).toBe(true);
    held[1]?.reply();
    await pending;
    expect(list.resources.value[0]?.id).toBe('土地资源-41');
    expect(list.isError.value).toBe(false);
  });

  it('新筛选失败不继承占位数据的总数，旧条件的总数仍保留', async () => {
    const { list } = await loadList();
    const held = holdPages();
    list.filterForm.name = '没有结果';
    list.search();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(list.resources.value).toHaveLength(20);
    held[0]?.reply({ code: 500, msg: '查询失败' });
    await vi.waitFor(() => expect(list.isError.value).toBe(true));
    expect(list.total.value).toBe(0);
    list.resetFilters();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(list.total.value).toBe(48);
  });

  it('仅成功结果修正越界页；后端空结果的 pages=0 仍停在首页', async () => {
    const { list } = await loadList();
    total = 40;
    list.pageNum.value = 999;
    await vi.waitFor(() => expect(list.pageNum.value).toBe(2));
    await vi.waitFor(() => expect(requests.at(-1)?.pageNum).toBe(2));
    expect(list.total.value).toBe(40);
    total = 0;
    await list.refresh();
    await vi.waitFor(() => expect(list.pageNum.value).toBe(1));
    expect(list.total.value).toBe(0);
    expect(list.resources.value).toEqual([]);
  });

  it('缓存里过时的总页数不修正页码，后台刷新失败也不修正', async () => {
    const { list } = await loadList();
    total = 40;
    list.pageNum.value = 3;
    await vi.waitFor(() => expect(list.pageNum.value).toBe(2));
    await vi.waitFor(() => expect(requests.at(-1)?.pageNum).toBe(2));
    total = 48;
    await list.refresh();
    expect(list.total.value).toBe(48);
    const held = holdPages();
    list.pageNum.value = 3;
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(list.pageNum.value).toBe(3);
    expect(list.total.value).toBe(48);
    expect(list.refreshing.value).toBe(false);
    held[0]?.reply({ code: 500, msg: '后台刷新失败' });
    await vi.waitFor(() => expect(list.isError.value).toBe(true));
    expect(list.pageNum.value).toBe(3);
    expect(list.total.value).toBe(48);
    expect(list.resources.value).toHaveLength(20);
  });

  it('从缓存重新进入后立即翻页失败，仍保留缓存初始化的总数', async () => {
    const previous = await loadList();
    previous.wrapper.unmount();
    const held = holdPages();
    const { list } = mountList(previous.queryClient);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(list.total.value).toBe(48);
    expect(list.refreshing.value).toBe(false);
    list.pageNum.value = 3;
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1]?.reply({ code: 500, msg: '分页失败' });
    await vi.waitFor(() => expect(list.isError.value).toBe(true));
    expect(list.total.value).toBe(48);
    expect(list.pageNum.value).toBe(3);
  });

  it('同名目录按 ID 隔离缓存，不能借用上一个目录的占位数据', async () => {
    const water = tree.data[0]?.children?.[1];
    if (water) {
      water.name = '土地资源';
    }
    const { list, queryClient } = await loadList();
    const held = holdPages();
    list.selectDirectory('water');
    expect(list.resources.value).toEqual([]);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(list.resources.value).toEqual([]);
    expect(queryClient.getQueryCache().findAll({ queryKey: resourceManagementKeys.pages() })
      .filter(query => query.queryKey[2] !== null)).toHaveLength(2);
  });

  it('旧目录请求取消后晚到的结果不改变新目录的记录、总数或页码', async () => {
    const held = holdPages();
    const { list, queryClient } = mountList();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    list.selectDirectory('water');
    await vi.waitFor(() => expect(held).toHaveLength(2));
    const oldKey = resourceManagementKeys.page({ directoryId: 'land', params: {
      resource: '土地资源', pageNum: 1, pageSize: 20
    } });
    expect(queryClient.getQueryState(oldKey)?.fetchStatus).toBe('idle');
    held[1]?.reply(resourcePageResponse({ resource: '水资源', total: 2 }));
    await vi.waitFor(() => expect(list.resources.value).toHaveLength(2));
    held[0]?.reply(resourcePageResponse({ total: 300, pageNum: 20 }));
    await flushPromises();
    expect(list.resources.value[0]?.resourceName).toBe('水资源');
    expect(list.total.value).toBe(2);
    expect(list.pageNum.value).toBe(1);
    expect(queryClient.getQueryData(oldKey)).toBeUndefined();
  });

  it('组件卸载取消实际 HTTP 请求，晚到的 401 不触发会话过期', async () => {
    const onUnauthorized = vi.fn<() => void>();
    configureHttp({ onUnauthorized });
    const held = holdPages();
    const { wrapper } = mountList();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    wrapper.unmount();
    held[0]?.reply({ code: 401, msg: '旧请求过期' });
    await vi.waitFor(() => expect(held[0]?.returned).toBe(true));
    await flushPromises();
    await flushPromises();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each(['/backend/resource-center/tree', '/backend/resource-center/year/list'])(
    '卸载时取消 %s，晚到的 401 不触发会话过期', async url => {
      const onUnauthorized = vi.fn<() => void>();
      configureHttp({ onUnauthorized });
      let reply: (() => void) | undefined;
      let returned = false;
      server.use(mock.get(url, async () => {
        await new Promise<void>(resolve => {
          reply = resolve;
          releases.add(resolve);
        });
        returned = true;
        return HttpResponse.json({ code: 401 });
      }));
      const { wrapper } = mountList();
      await vi.waitFor(() => expect(reply).toBeDefined());
      wrapper.unmount();
      reply?.();
      await vi.waitFor(() => expect(returned).toBe(true));
      await flushPromises();
      await flushPromises();
      expect(onUnauthorized).not.toHaveBeenCalled();
    }
  );

  it('主动刷新后切走再切回，只按缓存后台读取，不沿用先前的主动刷新标记', async () => {
    const { list } = await loadList();
    const held = holdPages();
    const pending = list.refresh();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    list.selectDirectory('water');
    await vi.waitFor(() => expect(held).toHaveLength(2));
    list.selectDirectory('land');
    await vi.waitFor(() => expect(held).toHaveLength(3));
    expect(list.refreshing.value).toBe(false);
    held.forEach(entry => entry.reply());
    await pending;
  });

  it('同一轮切目录再刷新只请求新目录；刷新期间切走不把遮罩带到新目录', async () => {
    const { list } = await loadList();
    const held = holdPages();
    list.selectDirectory('water');
    const pending = list.refresh();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(held[0]?.params.resource).toBe('水资源');
    list.selectDirectory('land');
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(list.resources.value[0]?.resourceName).toBe('土地资源');
    expect(list.refreshing.value).toBe(false);
    held[0]?.reply();
    held[1]?.reply();
    await pending;
  });

  it('多个使用方复用目录、年份和相同列表请求，一个卸载不取消另一个的读取', async () => {
    const held = holdPages();
    const client = createClient();
    const first = mountList(client);
    const second = mountList(client);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    first.wrapper.unmount();
    held[0]?.reply();
    await vi.waitFor(() => expect(second.list.resources.value).toHaveLength(20));
    expect(requests).toHaveLength(1);
    expect(client.getQueryData(resourceManagementKeys.directory())).toBeDefined();
    expect(client.getQueryData(resourceManagementKeys.years())).toBeDefined();
    await nextTick();
  });
});
