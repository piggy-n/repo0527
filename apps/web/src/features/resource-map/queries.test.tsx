import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { useResourceCatalogQuery } from './queries';
import { resourceTreeData, resourceTreeResponse } from './test-data';

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

// 每次请求都返回新的响应对象，用来验证结构共享：内容相同时缓存保留原来的树
function mockTree(data: () => unknown = resourceTreeData) {
  let requests = 0;
  server.use(
    mock.get('/backend/resource-map/base/tree', () => {
      requests++;
      return HttpResponse.json(resourceTreeResponse(data()));
    })
  );
  return () => requests;
}

let catalog: ReturnType<typeof useResourceCatalogQuery>;

const Host = defineComponent({
  setup() {
    catalog = useResourceCatalogQuery();
    return () => null;
  }
});

function mountHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
}

describe('useResourceCatalogQuery', () => {
  it('得出目录：按 code 去重', async () => {
    mockTree();
    mountHost();

    await vi.waitFor(() => expect(catalog.data.value).toBeDefined());
    expect([...(catalog.data.value?.resources.keys() ?? [])]).toStrictEqual([
      'bgdc_cjdcq',
      'bgdc_cjdcqjx',
      'bgdc_dltb',
      'csxhjctb_hydl',
      'csxhjctb_gyssp',
      'szy_kt',
      'gtkjgh_czkfbj'
    ]);
  });

  it('刷新后内容没变：还是同一个目录对象；内容变了才得出新目录', async () => {
    let data = resourceTreeData();
    const requests = mockTree(() => data);
    mountHost();
    await vi.waitFor(() => expect(catalog.data.value).toBeDefined());
    const first = catalog.data.value;

    await catalog.refetch();
    expect(requests()).toBe(2);
    expect(catalog.data.value).toBe(first);

    data = resourceTreeData();
    data[2]?.children.pop();
    await catalog.refetch();
    expect(catalog.data.value).not.toBe(first);
    expect(catalog.data.value?.resources.has('gtkjgh_czkfbj')).toBe(false);
  });
});
