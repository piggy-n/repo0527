import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { useSceneModelsQuery } from './queries';

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

const MANIFEST = {
  models: [
    { id: 'station', name: '苏州站地下空间', cityCode: '320500', kind: 'indoor', underground: true, tileset: 'S/a.json' }
  ]
};

function mockManifest(body: JsonBodyType = MANIFEST) {
  let requests = 0;
  server.use(
    mock.get('*/3dt/manifest.json', () => {
      requests++;
      return HttpResponse.json(body);
    })
  );
  return () => requests;
}

function mountHost() {
  const enabled = ref(false);
  let query: ReturnType<typeof useSceneModelsQuery> | undefined;
  const Host = defineComponent(() => {
    query = useSceneModelsQuery(enabled);
    return () => null;
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  if (!query) {
    throw new Error('没有创建查询');
  }
  return { query, enabled };
}

describe('useSceneModelsQuery', () => {
  it('enabled 为 false 时不请求；打开后读部署目录下的清单，地址按清单的地址解析成绝对地址；再次打开不重新请求', async () => {
    const requests = mockManifest();
    const { query, enabled } = mountHost();
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(requests()).toBe(0);

    enabled.value = true;
    await vi.waitFor(() => expect(query.data.value).toBeDefined());
    expect(requests()).toBe(1);
    expect(query.data.value?.map(({ id, cityName, effects }) => [id, cityName, effects[0]?.url])).toStrictEqual([
      ['station', '苏州市', new URL('/3dt/S/a.json', window.location.href).href]
    ]);

    enabled.value = false;
    await nextTick();
    enabled.value = true;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(query.isFetching.value).toBe(false);
    expect(requests()).toBe(1);
  });

  it('清单不合法时整份按失败处理', async () => {
    mockManifest({ models: [{ ...MANIFEST.models[0], kind: 'bim' }] });
    const { query, enabled } = mountHost();
    enabled.value = true;

    await vi.waitFor(() => expect(query.isError.value).toBe(true));
    expect(query.data.value).toBeUndefined();
  });
});
