import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { auditApplication, fetchApplication, fetchSystemFile, fetchSystemPage, type SystemPageRequest } from './api';
import { canDownload, downloadTarget, taskLabel } from './presentation';

const server = setupServer();
const request: SystemPageRequest = {
  section: 'audit', name: '土地', status: 'rejected', taskStatus: 'all', pageNum: 2, pageSize: 20
};
const application = { apply_id: 'a/1', apply_name: '调查成果', status: 'approved' as const, storage_status: 'success' };
const success = (data: unknown) => HttpResponse.json({ code: 200, data });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('系统管理接口边界', () => {
  it('申请筛选按旧参数发送，保留 table 状态，不将其归为待审核', async () => {
    let body: unknown;
    server.use(mock.post('/backend/api/apply/list', async ({ request: incoming }) => {
      body = await incoming.json();
      return success({ list: [{ ...application, status: 'table' }], total: 21, pageNum: 2, pageSize: 20, pages: 2 });
    }));
    const page = await fetchSystemPage(request);
    expect(body).toEqual({ applyName: '土地', status: 'rejected', taskStatus: '', pageNum: 2, pageSize: 20 });
    expect(page.list[0]).toMatchObject({ kind: 'audit', status: 'table' });
  });

  it('报表只发送名称和分页，不携带审核筛选', async () => {
    let body: unknown;
    server.use(mock.post('/backend/statistics/page', async ({ request: incoming }) => {
      body = await incoming.json();
      return success({ list: [], total: 0, pageNum: 1, pageSize: 20, pages: 0 });
    }));
    await fetchSystemPage({ ...request, section: 'reports', pageNum: 1 });
    expect(body).toEqual({ name: '土地', pageNum: 1, pageSize: 20 });
  });

  it('详情错误身份及无效审核状态均拒绝，不退回列表或补默认状态', async () => {
    server.use(mock.get('/backend/api/apply/:id', () => success({ ...application, apply_id: 'other' })));
    await expect(fetchApplication('a/1')).rejects.toMatchObject({ kind: 'invalid-response' });
    server.use(mock.get('/backend/api/apply/:id', () => success({ ...application, status: 'unknown' })));
    await expect(fetchApplication('a/1')).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('审核参数放在查询中，通过时清空拒绝原因；失败保留业务错误', async () => {
    const queries: Record<string, string>[] = [];
    server.use(mock.post('/backend/api/apply/status/:id', ({ request: incoming }) => {
      queries.push(Object.fromEntries(new URL(incoming.url).searchParams));
      return success(null);
    }));
    await auditApplication({ id: 'a/1', status: 'approved', reason: '旧原因' });
    await auditApplication({ id: 'a/1', status: 'rejected', reason: '用途不完整' });
    expect(queries).toEqual([{ status: 'approved', reason: '' }, { status: 'rejected', reason: '用途不完整' }]);
    server.use(mock.post('/backend/api/apply/status/:id', () => HttpResponse.json({ code: 500, msg: '审核冲突' })));
    await expect(auditApplication({ id: 'a/1', status: 'approved', reason: '' }))
      .rejects.toMatchObject({ kind: 'business', message: '审核冲突' });
  });

  it('申请 POST 下载、报表 GET 下载，同名 ID 分开管理并使用正确后备名称', async () => {
    const methods: string[] = [];
    server.use(
      mock.post('/backend/api/apply/download/:id', ({ request: incoming }) => {
        methods.push(incoming.method);
        return new HttpResponse('zip', { headers: { 'Content-Type': 'application/zip' } });
      }),
      mock.get('/backend/statistics/download', ({ request: incoming }) => {
        methods.push(`${incoming.method}:${new URL(incoming.url).searchParams.get('id')}`);
        return new HttpResponse('zip', { headers: { 'Content-Type': 'application/zip' } });
      })
    );
    const first = downloadTarget({ ...application, kind: 'audit' });
    const second = downloadTarget({ kind: 'reports', id: application.apply_id, name: '报告.zip', status: 'success' });
    expect(first.id).not.toBe(second.id);
    const signal = new AbortController().signal;
    expect((await fetchSystemFile(first, signal, () => undefined)).fileName).toBe('调查成果.zip');
    expect((await fetchSystemFile(second, signal, () => undefined)).fileName).toBe('报告.zip');
    expect(methods).toEqual(['POST', 'GET:a/1']);
  });

  it('未知准备状态只显示原值，未审核申请和未完成报表不能下载', () => {
    expect(taskLabel('new-state')).toBe('new-state');
    expect(canDownload({ ...application, kind: 'audit', status: 'pending' })).toBe(false);
    expect(canDownload({ ...application, kind: 'audit', status: 'table' })).toBe(true);
    expect(canDownload({ kind: 'reports', id: 'one', name: '报表', status: 'completed' })).toBe(false);
  });
});
