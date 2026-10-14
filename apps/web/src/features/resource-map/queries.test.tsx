import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, shallowRef } from 'vue';
import { type FeatureKey, resourceMapKeys, useFeatureDetailQuery, useResourceCatalogQuery } from './queries';
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

const page = (list: unknown[]) => ({ total: list.length, list });

// 条件是 "guid" = '…'，取出其中的 guid
const guidOf = (request: Request) => (new URL(request.url).searchParams.get('conditions') ?? '').slice(10, 42);

describe('useFeatureDetailQuery', () => {
  const GUID_A = 'a'.repeat(32);
  const GUID_B = 'b'.repeat(32);
  const POINT = { type: 'Point', coordinates: [119.28, 33.82] };

  // 属性和几何按 guid 返回；GUID_A 的属性请求一直不返回
  function mockDetail() {
    server.use(
      mock.get('/backend/api/query/attr/page', async ({ request }) => {
        const guid = guidOf(request);
        if (guid === GUID_A) {
          await new Promise(() => {});
        }
        return HttpResponse.json(page([{ guid, name: `要素 ${guid[0]}` }]));
      }),
      mock.get('/backend/api/query/scope/geojson', ({ request }) =>
        HttpResponse.json([{ guid: guidOf(request), geom: JSON.stringify(POINT) }])
      )
    );
  }

  let detail: ReturnType<typeof useFeatureDetailQuery>;
  let queryClient: QueryClient;
  const feature = shallowRef<FeatureKey | null>(null);

  const DetailHost = defineComponent({
    setup() {
      detail = useFeatureDetailQuery(feature);
      return () => null;
    }
  });

  function mountDetail(key: FeatureKey | null) {
    feature.value = key;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mount(DetailHost, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  }

  it('没有要素时不查询', async () => {
    mockDetail();
    mountDetail(null);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(detail.fetchStatus.value).toBe('idle');
    expect(detail.status.value).toBe('pending');
    expect(detail.data.value).toBeUndefined();
  });

  it('按图层编码和 guid 查属性和完整几何', async () => {
    mockDetail();
    mountDetail({ layerCode: 'bgdc_dltb_2022', guid: GUID_B });

    await vi.waitFor(() => expect(detail.data.value).toBeDefined());
    expect(detail.data.value).toStrictEqual({
      feature: { layerCode: 'bgdc_dltb_2022', guid: GUID_B },
      detail: { properties: { guid: GUID_B, name: '要素 b' }, geometry: POINT }
    });
  });

  // MSW 收到的 request.signal 不随 axios 的取消而中止，所以看缓存里旧查询的状态：取消后立即回到 idle，
  // 没取消的话会一直是 fetching（模拟接口一直挂着）
  it('换了要素时取消上一个请求，显示新要素的详情', async () => {
    mockDetail();
    mountDetail({ layerCode: 'bgdc_dltb_2022', guid: GUID_A });
    await vi.waitFor(() => expect(detail.fetchStatus.value).toBe('fetching'));

    feature.value = { layerCode: 'bgdc_dltb_2022', guid: GUID_B };

    await vi.waitFor(() => expect(detail.data.value).toBeDefined());
    expect(detail.data.value?.detail.properties).toStrictEqual({ guid: GUID_B, name: '要素 b' });
    const previous = queryClient.getQueryState(resourceMapKeys.featureDetail('bgdc_dltb_2022', GUID_A));
    expect(previous?.fetchStatus).toBe('idle');
  });
});
