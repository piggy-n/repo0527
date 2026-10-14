import type { Point } from 'geojson';
import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureHttp } from '@/shared/http/configure';
import { ApiError } from '@/shared/http/errors';
import { fetchFeatureDetail, fetchResourceTree, guidCondition, queryFeaturesAt } from './api';
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

// 实测的记录（2026-10-14，地类图斑），只留几个字段
const GUID = '1e6325bc5c544dc4b845cdd328d2599c';
const RECORD = { guid: GUID, bsm: '320826211000006380', dlbm: '0101', dlmc: '水田', tbmj: 6033.8398 };
const SQUARE = { type: 'Polygon', coordinates: [[[119, 33], [119.1, 33], [119.1, 33.1], [119, 33]]] };

// 分页插件的返回（没有信封）
const page = (list: unknown[]) => ({ total: list.length, list, pageNum: 1, pageSize: 2, pages: 1 });

// 记下请求的查询参数，返回给定的响应
function mockQuery(path: string, body: JsonBodyType, received: URLSearchParams[] = []) {
  server.use(
    mock.get(`/backend${path}`, ({ request }) => {
      received.push(new URL(request.url).searchParams);
      return HttpResponse.json(body);
    })
  );
  return received;
}

describe('要素查询（ADR 0047）', () => {
  it('范围查询：图层编码、几何（JSON）、相交、分页都放在查询参数里；返回没有信封', async () => {
    const received = mockQuery('/api/query/scope/geojson/page', page([RECORD]));
    const point: Point = { type: 'Point', coordinates: [119.28, 33.82] };

    const result = await queryFeaturesAt('bgdc_dltb_2022', point, { pageNum: 2, pageSize: 30 });

    expect(result).toStrictEqual({ total: 1, list: [RECORD] });
    expect(Object.fromEntries(received[0] ?? [])).toStrictEqual({
      layerCode: 'bgdc_dltb_2022',
      geometry: JSON.stringify(point),
      relation: 'INTERSECTS',
      pageNum: '2',
      pageSize: '30'
    });
  });

  it('详情：按 guid 并行查属性（全省）和完整几何（全世界范围），几何字符串解析成 GeoJSON', async () => {
    const attributes = mockQuery('/api/query/attr/page', page([RECORD]));
    const geometries = mockQuery('/api/query/scope/geojson', [{ guid: GUID, geom: JSON.stringify(SQUARE) }]);

    const detail = await fetchFeatureDetail('bgdc_dltb_2022', GUID);

    expect(detail).toStrictEqual({ properties: RECORD, geometry: SQUARE });
    expect(Object.fromEntries(attributes[0] ?? [])).toMatchObject({
      layerCode: 'bgdc_dltb_2022',
      xzqdm: '320000',
      conditions: `"guid" = '${GUID}'`
    });
    const geometryQuery = Object.fromEntries(geometries[0] ?? []);
    expect(geometryQuery).toMatchObject({ layerCode: 'bgdc_dltb_2022', conditions: `"guid" = '${GUID}'` });
    expect(JSON.parse(geometryQuery.geometry ?? '')).toStrictEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-180, -85],
          [180, -85],
          [180, 85],
          [-180, 85],
          [-180, -85]
        ]
      ]
    });
  });

  it('详情：没有记录、多于一条时抛错', async () => {
    mockQuery('/api/query/attr/page', page([]));
    mockQuery('/api/query/scope/geojson', [{ guid: GUID, geom: JSON.stringify(SQUARE) }]);
    await expect(fetchFeatureDetail('bgdc_dltb_2022', GUID)).rejects.toThrow('没有找到这个要素的完整信息');

    mockQuery('/api/query/attr/page', page([RECORD]));
    mockQuery('/api/query/scope/geojson', [
      { guid: GUID, geom: JSON.stringify(SQUARE) },
      { guid: GUID, geom: JSON.stringify(SQUARE) }
    ]);
    await expect(fetchFeatureDetail('bgdc_dltb_2022', GUID)).rejects.toThrow('主键对应多条记录');
  });

  it('几何不是合法的 JSON、坐标不是数时 invalid-response；接口返回出错的信封时 business', async () => {
    mockQuery('/api/query/attr/page', page([RECORD]));
    mockQuery('/api/query/scope/geojson', [{ guid: GUID, geom: '{"type":' }]);
    const broken = await fetchFeatureDetail('bgdc_dltb_2022', GUID).catch((error: unknown) => error);
    expect(broken instanceof ApiError && broken.kind).toBe('invalid-response');

    const textPoint = JSON.stringify({ type: 'Point', coordinates: ['a', 1] });
    mockQuery('/api/query/scope/geojson', [{ guid: GUID, geom: textPoint }]);
    const invalid = await fetchFeatureDetail('bgdc_dltb_2022', GUID).catch((error: unknown) => error);
    expect(invalid instanceof ApiError && invalid.kind).toBe('invalid-response');

    mockQuery('/api/query/attr/page', { success: false, code: 500, data: null, msg: '系统异常' });
    const failed = await fetchFeatureDetail('szy_kt_2025', GUID).catch((error: unknown) => error);
    expect(failed instanceof ApiError && [failed.kind, failed.message]).toStrictEqual(['business', '系统异常']);
  });

  it('guid 格式不对时不发请求，直接抛错', async () => {
    expect(() => guidCondition("a' OR '1'='1")).toThrow('要素主键格式不对');
    await expect(fetchFeatureDetail('bgdc_dltb_2022', 'ABC')).rejects.toThrow('要素主键格式不对');
  });
});
