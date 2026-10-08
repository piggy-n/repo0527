import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { FilePageParams } from './api';
import { fileKeys, useDeleteFileMutation, useFilePageQuery } from './queries';
import { filePageResponse } from './test-data';

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

interface PendingRequest {
  params: Record<string, string>;
  release: () => void;
}

// /file/page 收到请求后挂起，用例调用 release 才返回；每个分类都有 45 条数据（每页 20 条，共 3 页）
function mockPendingFilePage() {
  const requests: PendingRequest[] = [];
  server.use(
    mock.get('/backend/file/page', async ({ request }) => {
      const params = Object.fromEntries(new URL(request.url).searchParams);
      // Promise 的执行函数同步运行，请求到达时就已登记（没用 Promise.withResolvers：它是 ES2024，项目的 lib 是 ES2023）
      await new Promise<void>(resolve => {
        requests.push({ params, release: resolve });
      });
      const { categoryId, pageNo, pageSize } = params;
      return HttpResponse.json(
        filePageResponse({ categoryId, pageNo: Number(pageNo), pageSize: Number(pageSize), totalElements: 45 })
      );
    })
  );
  return requests;
}

let params: ReturnType<typeof ref<FilePageParams>>;
let page: ReturnType<typeof useFilePageQuery>;
let removal: ReturnType<typeof useDeleteFileMutation>;

const Host = defineComponent({
  setup() {
    params = ref<FilePageParams>({ categoryId: 'policy-law-local', pageNo: 1, pageSize: 20 });
    page = useFilePageQuery(() => params.value as FilePageParams);
    removal = useDeleteFileMutation();
    return () => null;
  }
});

let queryClient: QueryClient;

// 每个用例用新的 QueryClient，缓存不在用例之间残留
function mountHost() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
}

const firstId = () => page.data.value?.content[0]?.id;

async function loadFirstPage(requests: PendingRequest[]) {
  mountHost();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0]?.release();
  await vi.waitFor(() => expect(firstId()).toBe('file-policy-law-local-1'));
}

describe('useFilePageQuery', () => {
  it('同一分类内翻页：新页返回前保留上一页的数据', async () => {
    const requests = mockPendingFilePage();
    await loadFirstPage(requests);

    params.value = { categoryId: 'policy-law-local', pageNo: 2, pageSize: 20 };
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(firstId()).toBe('file-policy-law-local-1');
    expect(page.isPlaceholderData.value).toBe(true);

    requests[1]?.release();
    await vi.waitFor(() => expect(firstId()).toBe('file-policy-law-local-21'));
    expect(page.isPlaceholderData.value).toBe(false);
  });

  it('换分类：新分类返回前不显示上一个分类的数据', async () => {
    const requests = mockPendingFilePage();
    await loadFirstPage(requests);

    params.value = { categoryId: 'government-document-notice', pageNo: 1, pageSize: 20 };
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(page.data.value).toBeUndefined();

    requests[1]?.release();
    await vi.waitFor(() => expect(firstId()).toBe('file-government-document-notice-1'));
  });

  // MSW 收到的 request.signal 不随 axios 的取消而中止（已实测），所以看缓存里旧查询的状态：
  // 取消后它立即回到 idle，没取消的话会一直是 fetching（模拟接口一直挂着）
  it('参数在请求返回前又变了：取消上一个请求', async () => {
    const requests = mockPendingFilePage();
    mountHost();
    const first: FilePageParams = { categoryId: 'policy-law-local', pageNo: 1, pageSize: 20 };
    const second: FilePageParams = { categoryId: 'government-document-notice', pageNo: 1, pageSize: 20 };
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    params.value = second;
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(queryClient.getQueryState(fileKeys.page(first))?.fetchStatus).toBe('idle');
    expect(queryClient.getQueryState(fileKeys.page(second))?.fetchStatus).toBe('fetching');
  });
});

describe('useDeleteFileMutation', () => {
  it('删除成功后重新请求当前页，列表更新后才算完成', async () => {
    const requests = mockPendingFilePage();
    const deleted: string[] = [];
    server.use(
      mock.get('/backend/file/delete', ({ request }) => {
        deleted.push(new URL(request.url).searchParams.get('id') ?? '');
        return HttpResponse.json({ code: 200, data: null, msg: '删除成功', success: true });
      })
    );
    await loadFirstPage(requests);

    let settled = false;
    const done = (async () => {
      await removal.mutateAsync('file-policy-law-local-1');
      settled = true;
    })();
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(deleted).toEqual(['file-policy-law-local-1']);
    expect(requests[1]?.params).toEqual(requests[0]?.params);
    expect(settled).toBe(false);

    requests[1]?.release();
    await done;
    expect(settled).toBe(true);
  });
});
