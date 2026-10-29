import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http } from '@/shared/http/client';
import { exportFileName, exportResult, fetchResultFeatures, fetchResultPage, type QueryRequest } from './api';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

// 2026-10-28 实测的返回（去掉用不到的字段）
const PAGE = { total: 1, pageNum: 1, pages: 1, list: [{ guid: 'g', name: '南京市琅琊路小学', type: '小学' }] };
const FEATURES = [{ guid: 'g', geom: '{"type":"Point","coordinates":[118.81,32.09]}' }];
const FAILURE = { success: false, code: 500, data: null, msg: '系统异常' };

const ATTRIBUTE: QueryRequest = {
  kind: 'attribute',
  origin: 'attribute',
  layerCode: 'csxhjctb_xxp_2022',
  xzqdm: '320100',
  conditions: "TYPE IN ('小学')"
};
const GEOMETRY: QueryRequest = {
  kind: 'geometry',
  layerCode: 'csxhjctb_xxp_2022',
  geometry: '{"type":"Polygon","coordinates":[]}',
  bounds: [118, 32, 119, 33]
};
const SHP: QueryRequest = {
  kind: 'shp',
  layerCode: 'csxhjctb_xxp_2022',
  fileId: 1,
  file: new File(['shp'], '范围.zip')
};

const params = (request: Request) => Object.fromEntries(new URL(request.url).searchParams);
// 导出接口返回的文件流
const zipResponse = () => new HttpResponse('PK', { headers: { 'Content-Type': 'application/zip' } });

// 交给公共层的 FormData 的各项；jsdom 与 Node 的 File 不兼容，不在 MSW 里解析 multipart（同文件管理的上传测试）
const entries = (body: unknown) =>
  Array.from(body as FormData, ([name, value]) => [name, typeof value === 'string' ? value : value.name]);

describe('结果表的一页', () => {
  it('属性类请求属性分页，参数放在地址里；返回没有信封', async () => {
    let query: Record<string, string> = {};
    server.use(
      mock.get('/backend/api/query/attr/page', ({ request }) => {
        query = params(request);
        return HttpResponse.json(PAGE);
      })
    );
    await expect(fetchResultPage(ATTRIBUTE, { pageNum: 2, pageSize: 100 })).resolves.toStrictEqual(PAGE);
    expect(query).toStrictEqual({
      layerCode: 'csxhjctb_xxp_2022',
      xzqdm: '320100',
      conditions: "TYPE IN ('小学')",
      pageNum: '2',
      pageSize: '100'
    });
  });

  it('画的范围请求范围分页；shp 用 POST，文件在正文里、其余参数在地址里', async () => {
    const seen: string[] = [];
    const post = vi.spyOn(http, 'post');
    server.use(
      mock.get('/backend/api/query/scope/geojson/page', ({ request }) => {
        seen.push(params(request).geometry ?? '');
        return HttpResponse.json(PAGE);
      }),
      mock.post('/backend/api/query/scope/shp/page', ({ request }) => {
        seen.push(params(request).pageNum ?? '');
        return HttpResponse.json(PAGE);
      })
    );
    await fetchResultPage(GEOMETRY, { pageNum: 1, pageSize: 100 });
    await fetchResultPage(SHP, { pageNum: 3, pageSize: 100 });
    expect(seen).toStrictEqual(['{"type":"Polygon","coordinates":[]}', '3']);
    expect(entries(post.mock.calls[0]?.[1])).toStrictEqual([['file', '范围.zip']]);
  });

  it('失败时按信封里的业务码转成 ApiError，不弹全局提示', async () => {
    server.use(mock.get('/backend/api/query/attr/page', () => HttpResponse.json(FAILURE)));
    await expect(fetchResultPage(ATTRIBUTE, { pageNum: 1, pageSize: 100 })).rejects.toMatchObject({
      kind: 'business',
      message: '系统异常'
    });
  });
});

describe('命中的要素', () => {
  it('geom 是 GeoJSON 字符串，解析成几何', async () => {
    server.use(mock.get('/backend/api/query/scope/geojson', () => HttpResponse.json(FEATURES)));
    await expect(fetchResultFeatures(GEOMETRY)).resolves.toStrictEqual([
      { guid: 'g', geom: { type: 'Point', coordinates: [118.81, 32.09] } }
    ]);
  });
});

describe('导出', () => {
  it('文件名：单独导出 Excel 是 xlsx，单独导出 shp、gdb 带格式后缀，多种格式打包成 zip（同旧页面）', () => {
    expect(exportFileName('学校点层', ['excel'])).toBe('学校点层.xlsx');
    expect(exportFileName('学校点层', ['gdb'])).toBe('学校点层_gdb.zip');
    expect(exportFileName('学校点层', ['excel', 'shp'])).toBe('学校点层.zip');
  });

  it('属性类按区划导出，画的范围按几何导出，格式用逗号连接；shp 把文件再传一次', async () => {
    const bodies: unknown[] = [];
    const postBlob = vi.spyOn(http, 'postBlob');
    server.use(
      mock.post('/backend/api/export/region', async ({ request }) => {
        bodies.push(await request.json());
        return zipResponse();
      }),
      mock.post('/backend/api/export/geojson', async ({ request }) => {
        bodies.push(await request.json());
        return zipResponse();
      }),
      mock.post('/backend/api/export/shp', zipResponse)
    );
    const region = await exportResult(ATTRIBUTE, ['excel', 'shp'], '学校点层');
    await exportResult(GEOMETRY, ['gdb'], '学校点层');
    await exportResult(SHP, ['excel'], '学校点层');

    expect(region.fileName).toBe('学校点层.zip');
    expect(entries(postBlob.mock.calls[2]?.[1])).toStrictEqual([
      ['file', '范围.zip'],
      ['layerCode', 'csxhjctb_xxp_2022'],
      ['relation', 'INTERSECTS'],
      ['format', 'excel'],
      ['fileName', '学校点层']
    ]);
    expect(bodies).toStrictEqual([
      {
        layerCode: 'csxhjctb_xxp_2022',
        xzqdm: '320100',
        relation: '',
        conditions: "TYPE IN ('小学')",
        format: 'excel,shp',
        fileName: '学校点层'
      },
      {
        layerCode: 'csxhjctb_xxp_2022',
        geometry: '{"type":"Polygon","coordinates":[]}',
        relation: 'INTERSECTS',
        conditions: '',
        format: 'gdb',
        fileName: '学校点层'
      }
    ]);
  });
});
