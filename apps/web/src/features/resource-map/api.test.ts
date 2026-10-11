import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureHttp } from '@/shared/http/configure';
import { ApiError } from '@/shared/http/errors';
import { fetchResourceTree } from './api';
import { resourceTreeData, resourceTreeResponse } from './test-data';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  configureHttp({});
});

afterAll(() => {
  server.close();
});

function mockTree(body: JsonBodyType = resourceTreeResponse()) {
  server.use(mock.get('/backend/resource-map/base/tree', () => HttpResponse.json(body)));
}

describe('fetchResourceTree', () => {
  it('按实测结构解析：分类带 children（可能为空），图层没有；丢弃未声明的 resource 字段', async () => {
    mockTree();

    const tree = await fetchResourceTree();

    expect(tree.map(({ code, name }) => [code, name])).toStrictEqual([
      [null, '基础库'],
      [null, '公共库'],
      ['sqsx', '三区三线']
    ]);
    const [land] = tree[0]?.children ?? [];
    expect(land && 'children' in land ? land.children[2] : undefined).toStrictEqual({
      code: 'bgdc_dltb',
      name: '地类图斑',
      geoType: 'Polygon',
      yearList: [2022]
    });
    expect(tree[0]?.children[1]).toStrictEqual({ code: null, name: '海洋资源', children: [] });
  });

  it('几何类型不在 Polygon、Line、Point 之内：格式不符', async () => {
    const data = resourceTreeData();
    data[2]?.children.push({ code: 'x', name: '未知', geoType: 'MultiPolygon', resource: '三区三线', yearList: [2026] });
    mockTree(resourceTreeResponse(data));

    await expect(fetchResourceTree()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('年份列表为空：格式不符', async () => {
    const data = resourceTreeData();
    data[2]?.children.push({ code: 'x', name: '空', geoType: 'Polygon', resource: '三区三线', yearList: [] });
    mockTree(resourceTreeResponse(data));

    await expect(fetchResourceTree()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('业务码不是 200：抛出 ApiError，不弹全局提示（失败由资源列表显示并重试）', async () => {
    const onError = vi.fn<(error: ApiError) => void>();
    configureHttp({ onError });
    mockTree({ code: 500, msg: '系统异常', success: false, data: null });

    await expect(fetchResourceTree()).rejects.toBeInstanceOf(ApiError);
    expect(onError).not.toHaveBeenCalled();
  });
});
