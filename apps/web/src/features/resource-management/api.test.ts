import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureHttp } from '@/shared/http/configure';
import { ApiError } from '@/shared/http/errors';
import { fetchResourceDirectory, fetchResourcePage, fetchResourceYears } from './api';
import { resourceDirectoryResponse, resourcePageResponse, resourceYearsResponse } from './test-data';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  configureHttp({});
});
afterAll(() => server.close());

describe('资源管理读取接口', () => {
  it('目录保留层级、接口顺序及空分组，允许可选图标和 null code', async () => {
    server.use(mock.get('/backend/resource-center/tree', () => HttpResponse.json(resourceDirectoryResponse())));

    const tree = await fetchResourceDirectory();

    expect(tree.map(node => node.id)).toEqual(['base', 'public', 'three']);
    expect(tree[0]).toMatchObject({ parentId: null, code: null });
    expect(tree[0]?.children?.map(node => node.id)).toEqual(['land', 'water']);
    expect(tree[0]?.children?.[0]).toMatchObject({ children: null, iconSelected: '土地资源1@1x.png' });
    expect(tree[2]).toMatchObject({ id: 'three', children: null });
  });

  it('年份直接使用字符串 label/value 和后端顺序，丢弃未使用字段', async () => {
    server.use(mock.get('/backend/resource-center/year/list', () => HttpResponse.json(resourceYearsResponse())));

    await expect(fetchResourceYears()).resolves.toEqual([
      { label: '2025', value: '2025' }, { label: '2024', value: '2024' }, { label: '2023', value: '2023' }
    ]);
  });

  it('列表通过 POST JSON 传目录名称、页码与筛选，沿用 shared 的鉴权头', async () => {
    const received: unknown[] = [];
    configureHttp({ getHeaders: () => ({ Authorization: 'test-resource-session' }) });
    server.use(mock.post('/backend/resource-management/layer/page', async ({ request }) => {
      received.push({ body: await request.json(), query: new URL(request.url).search,
        authorization: request.headers.get('Authorization'), contentType: request.headers.get('Content-Type') });
      return HttpResponse.json(resourcePageResponse({ pageNum: 2 }));
    }));

    await fetchResourcePage({ resource: '土地资源', pageNum: 2, pageSize: 10, layerName: '地类图斑', year: '2024' });
    await fetchResourcePage({ resource: '水资源', pageNum: 1, pageSize: 20, layerName: undefined, year: undefined });

    expect(received).toEqual([
      { body: { resource: '土地资源', pageNum: 2, pageSize: 10, layerName: '地类图斑', year: '2024' },
        query: '', authorization: 'test-resource-session', contentType: 'application/json' },
      { body: { resource: '水资源', pageNum: 1, pageSize: 20 },
        query: '', authorization: 'test-resource-session', contentType: 'application/json' }
    ]);
  });

  it('解析数字年份、布尔切片和字符串启停，不把 false 字符串当真', async () => {
    server.use(mock.post('/backend/resource-management/layer/page', () => HttpResponse.json(resourcePageResponse())));

    const page = await fetchResourcePage({ resource: '土地资源', pageNum: 1, pageSize: 10 });

    expect(page).toMatchObject({ total: 24, pageNum: 1, pageSize: 10, pages: 3 });
    expect(page.list[0]).toEqual({
      id: '土地资源-1', name: '土地资源记录1', year: 2025, datasetName: '年度调查数据集', resourceName: '土地资源',
      layerCode: 'LAYER_1', datasetCode: 'DATASET', hasSlice: false, enabled: true
    });
    expect(page.list[1]?.hasSlice).toBe(true);
    expect(page.list[2]?.enabled).toBe(false);
  });

  it('保留后端修正后的 pageNum，接受 pages=0 的空结果', async () => {
    server.use(mock.post('/backend/resource-management/layer/page', () =>
      HttpResponse.json(resourcePageResponse({ pageNum: 999, total: 21 }))));
    await expect(fetchResourcePage({ resource: '土地资源', pageNum: 999, pageSize: 10 }))
      .resolves.toMatchObject({ pageNum: 3, pages: 3, total: 21, list: [{ id: '土地资源-21' }] });

    server.use(mock.post('/backend/resource-management/layer/page', () =>
      HttpResponse.json(resourcePageResponse({ total: 0 }))));
    await expect(fetchResourcePage({ resource: '气象', pageNum: 1, pageSize: 10 }))
      .resolves.toEqual({ pageNum: 1, pageSize: 10, pages: 0, total: 0, list: [] });
  });

  it.each([
    ['目录结构错误', '/backend/resource-center/tree', fetchResourceDirectory, { code: 200, data: [{ name: '缺少 ID' }] }],
    ['年份结构错误', '/backend/resource-center/year/list', fetchResourceYears,
      { code: 200, data: [{ label: '2025', value: 2025 }] }]
  ] as const)('%s 不降级为空数据', async (_name, url, fetchData, response) => {
    server.use(mock.get(url, () => HttpResponse.json(response)));
    await expect(fetchData()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('列表字段或分页结构不合法时抛出 invalid-response', async () => {
    const response = resourcePageResponse();
    server.use(mock.post('/backend/resource-management/layer/page', () => HttpResponse.json({
      ...response, data: { ...response.data, list: [{ ...response.data.list[0], enable: 'unknown' }] }
    })));
    await expect(fetchResourcePage({ resource: '土地资源', pageNum: 1, pageSize: 10 }))
      .rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('业务失败由页面处理，但 silent 不绕过 401 会话处理', async () => {
    const onError = vi.fn<() => void>();
    const onUnauthorized = vi.fn<() => void>();
    configureHttp({ onError, onUnauthorized });
    server.use(mock.get('/backend/resource-center/tree', () => HttpResponse.json({ code: 500, msg: '目录加载失败' })));
    const error = await fetchResourceDirectory().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'business', message: '目录加载失败' });
    expect(onError).not.toHaveBeenCalled();

    server.use(mock.get('/backend/resource-center/year/list', () => HttpResponse.json({ code: 401 })));
    await expect(fetchResourceYears()).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it.each([
    ['目录', fetchResourceDirectory],
    ['年份', fetchResourceYears],
    ['列表', (signal: AbortSignal) => fetchResourcePage({ resource: '土地资源', pageNum: 1, pageSize: 10 }, signal)]
  ] as const)('%s 传递取消信号，不产生普通错误或会话提示', async (_name, fetchData) => {
    const onError = vi.fn<() => void>();
    const onUnauthorized = vi.fn<() => void>();
    configureHttp({ onError, onUnauthorized });
    const controller = new AbortController();
    controller.abort();

    await expect(fetchData(controller.signal)).rejects.toMatchObject({ kind: 'canceled' });
    expect(onError).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
