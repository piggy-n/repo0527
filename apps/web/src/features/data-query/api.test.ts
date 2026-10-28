import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http } from '@/shared/http/client';
import { required } from '@/shared/testing/required';
import { downloadQuery, fetchQueryPage, fetchQueryShapes, type QueryDownload } from './api';
import { QUERY_LAYERS } from './config';
import type { QuerySnapshot } from './types';

const server = setupServer();
const signal = new AbortController().signal;
const snapshot: QuerySnapshot = {
  id: 'query',
  layer: QUERY_LAYERS.land[0],
  mode: 'attribute',
  conditions: "CZCLX IN ('201')",
  scope: { kind: 'region', code: '320100' },
  signature: ''
};
const polygon = { type: 'Polygon' as const, coordinates: [[[119, 33], [119.1, 33], [119, 33.1], [119, 33]]] };
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});

describe('数据查询调用契约', () => {
  it('属性分页使用原始分页响应，区划、条件及每页 20 条不丢失', async () => {
    let received: URLSearchParams | undefined;
    server.use(mock.get('/backend/api/query/attr/page', ({ request }) => {
      received = new URL(request.url).searchParams;
      return HttpResponse.json({ total: 21, list: [{ czclx: '201' }] });
    }));
    expect(await fetchQueryPage(snapshot, 2, signal)).toEqual({ total: 21, list: [{ czclx: '201' }] });
    expect(Object.fromEntries(required(received, '分页请求的参数'))).toMatchObject({
      layerCode: 'bgdc_czcdyd_2022',
      xzqdm: '320100',
      conditions: "CZCLX IN ('201')",
      pageNum: '2',
      pageSize: '20'
    });
  });

  it('几何查询序列化范围，结果解析几何；错误几何不静默丢弃', async () => {
    let geometry: string | null = null;
    server.use(mock.get('/backend/api/query/scope/geojson', ({ request }) => {
      geometry = new URL(request.url).searchParams.get('geometry');
      return HttpResponse.json([{ geom: JSON.stringify(polygon) }]);
    }));
    const request: QuerySnapshot = { ...snapshot, scope: { kind: 'geometry', geometry: polygon } };
    expect(await fetchQueryShapes(request, signal)).toEqual([{ geom: polygon }]);
    expect(geometry).toBe(JSON.stringify(polygon));
    server.use(mock.get('/backend/api/query/scope/geojson', () => HttpResponse.json([{ geom: '{' }])));
    await expect(fetchQueryShapes(request, signal)).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('SHP 分页用 FormData，文件、条件和分页同传', async () => {
    let body = '';
    server.use(mock.post('/backend/api/query/scope/shp/page', async ({ request }) => {
      // jsdom File 与 Node multipart 解析器不是同一实现，核对实际发出的文本协议
      body = await request.text();
      return HttpResponse.json({ total: 0, list: [] });
    }));
    const file = new File(['范围文件'], '范围.zip');
    const post = vi.spyOn(http, 'post');
    await fetchQueryPage({ ...snapshot, scope: { kind: 'shp', file } }, 3, signal);
    expect(body).toContain('name="pageNum"\r\n\r\n3');
    expect(body).toContain('name="pageSize"\r\n\r\n20');
    expect(body).toContain(snapshot.conditions);
    const form = post.mock.calls[0][1] as FormData;
    expect(form.get('file')).toBe(file);
  });

  it('导出 POST 传递 JSON 条件并采用响应文件名，业务失败不保存为文件', async () => {
    let body: unknown;
    server.use(mock.post('/backend/api/export/region', async ({ request }) => {
      body = await request.json();
      return new HttpResponse('excel', {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="result.xlsx"'
        }
      });
    }));
    const target: QueryDownload = { id: 'download', name: '查询结果', snapshot, formats: ['excel'] };
    expect((await downloadQuery(target, signal, vi.fn())).fileName).toBe('result.xlsx');
    expect(body).toMatchObject({ xzqdm: '320100', conditions: snapshot.conditions, format: 'excel', fileName: '查询结果' });
    server.use(mock.post('/backend/api/export/region', () => HttpResponse.json({ code: 500, msg: '导出失败' })));
    await expect(downloadQuery(target, signal, vi.fn())).rejects.toMatchObject({ kind: 'business' });
  });

  it('SHP 导出仍传原始文件与选定格式，接口成功信封不能冒充分页结果', async () => {
    let body = '';
    server.use(mock.post('/backend/api/export/shp', async ({ request }) => {
      body = await request.text();
      return new HttpResponse('zip', { headers: { 'Content-Type': 'application/zip' } });
    }));
    const file = new File(['范围'], '原始范围.shp');
    const post = vi.spyOn(http, 'postBlob');
    const target: QueryDownload = {
      id: 'shp',
      name: '范围结果',
      formats: ['shp', 'gdb'],
      snapshot: { ...snapshot, scope: { kind: 'shp', file } }
    };
    await downloadQuery(target, signal, vi.fn());
    expect(body).toContain('name="format"\r\n\r\nshp,gdb');
    const form = post.mock.calls[0][1] as FormData;
    expect(form.get('file')).toBe(file);
    server.use(mock.get('/backend/api/query/attr/page', () => HttpResponse.json({ code: 200, data: { list: [] } })));
    await expect(fetchQueryPage(snapshot, 1, signal)).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});
