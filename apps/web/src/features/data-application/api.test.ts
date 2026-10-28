import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttp } from '@/shared/http/configure';
import { auditApplication, fetchApplication, fetchApplicationPage } from './api';
import { applicationPageResponse, approvedRecord, envelope, pendingRecord, tableRecord } from './test-data';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
// 接口给的是 UTC 时间，按北京时间显示；把运行环境放在另一个时区，证明结果不随浏览器的时区变化
beforeEach(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles');
});
afterEach(() => {
  server.resetHandlers();
  configureHttp({});
});
afterAll(() => server.close());

const emptyFilters = { name: '', status: '', prepare: '' } as const;

describe('申请列表', () => {
  it('POST 正文沿用旧页面的字段名，空条件是空字符串', async () => {
    const bodies: unknown[] = [];
    server.use(
      mock.post('/backend/api/apply/list', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(applicationPageResponse([]));
      })
    );
    await fetchApplicationPage({ ...emptyFilters, pageNum: 1, pageSize: 20 });
    await fetchApplicationPage({ name: '拆除', status: 'pending', prepare: 'timeout', pageNum: 2, pageSize: 10 });
    expect(bodies).toEqual([
      { applyName: '', status: '', taskStatus: '', pageNum: 1, pageSize: 20 },
      { applyName: '拆除', status: 'pending', taskStatus: 'timeout', pageNum: 2, pageSize: 10 }
    ]);
  });

  it('蛇形字段转成界面字段：没有的键是 undefined，格式拆开，时间按北京时间', async () => {
    server.use(
      mock.post('/backend/api/apply/list', () =>
        HttpResponse.json(applicationPageResponse([pendingRecord(), approvedRecord()], { total: 35, pageNum: 2 })))
    );
    const page = await fetchApplicationPage({ ...emptyFilters, pageNum: 2, pageSize: 20 });

    expect(page).toEqual({
      total: 35,
      pageNum: 2,
      pageSize: 20,
      pages: 2,
      list: [
        {
          id: 'apply-pending',
          name: '拆除未尽区',
          applicant: undefined,
          department: '江苏省基础地理信息中心',
          layerCode: 'bgdc_dltb_2022',
          region: '江苏省南京市',
          appliedAt: '2026-10-28 11:29:36',
          startTime: '2026-10-27 20:29:18',
          endTime: '2026-11-27 20:29:18',
          formats: ['gdb'],
          purpose: '城市更新专项核查',
          status: 'pending',
          reason: undefined,
          prepare: undefined
        },
        {
          id: 'apply-approved',
          name: '城镇村等用地',
          applicant: '王立',
          department: '江苏省基础地理信息中心',
          layerCode: 'bgdc_czcdyd_2022',
          region: '江苏省',
          appliedAt: '2026-09-10 16:47:07',
          startTime: '2026-09-10 16:46:56',
          endTime: '2026-09-10 16:46:56',
          formats: ['excel', 'shp'],
          purpose: '业务',
          status: 'approved',
          reason: '',
          prepare: 'timeout'
        }
      ]
    });
  });

  it('统计任务没有名称、时间、图层和区划时也能显示', async () => {
    server.use(mock.post('/backend/api/apply/list', () => HttpResponse.json(applicationPageResponse([tableRecord()]))));
    const [task] = (await fetchApplicationPage({ ...emptyFilters, pageNum: 1, pageSize: 20 })).list;
    expect(task).toMatchObject({ id: 'table-1', status: 'table', formats: ['.zip'], startTime: '2026-06-29 08:17:28' });
    expect(task?.name).toBeUndefined();
    expect(task?.appliedAt).toBeUndefined();
  });

  it('没见过的状态不猜成别的状态，整页按返回格式错误处理', async () => {
    server.use(
      mock.post('/backend/api/apply/list', () =>
        HttpResponse.json(applicationPageResponse([approvedRecord({ storage_status: 'error' })])))
    );
    await expect(fetchApplicationPage({ ...emptyFilters, pageNum: 1, pageSize: 20 })).rejects.toMatchObject({
      kind: 'invalid-response'
    });
  });
});

describe('一条申请', () => {
  it('ID 编码进路径；不存在时是 null', async () => {
    const paths: string[] = [];
    server.use(
      mock.get('/backend/api/apply/:id', ({ params }) => {
        paths.push(String(params.id));
        const found = params.id === 'apply / &?' ? approvedRecord({ apply_id: 'apply / &?' }) : null;
        return HttpResponse.json(envelope(found));
      })
    );
    expect((await fetchApplication('apply / &?'))?.id).toBe('apply / &?');
    expect(await fetchApplication('missing')).toBeNull();
    expect(paths).toEqual(['apply / &?', 'missing']);
  });

  it('返回了另一条申请时按返回格式错误处理', async () => {
    server.use(
      mock.get('/backend/api/apply/:id', () => HttpResponse.json(envelope(approvedRecord({ apply_id: 'other' }))))
    );
    await expect(fetchApplication('apply-approved')).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});

describe('审核', () => {
  it('结果和原因放在 query 里、没有正文；通过时原因是空字符串', async () => {
    const received: unknown[] = [];
    server.use(
      mock.post('/backend/api/apply/status/:id', async ({ params, request }) => {
        received.push({
          id: params.id,
          query: Object.fromEntries(new URL(request.url).searchParams),
          body: await request.text()
        });
        return HttpResponse.json(envelope(null));
      })
    );
    await auditApplication({ id: 'apply-1', approved: true, reason: '不会发送' });
    await auditApplication({ id: 'apply-1', approved: false, reason: '用途不明确' });
    expect(received).toEqual([
      { id: 'apply-1', query: { status: 'approved', reason: '' }, body: '' },
      { id: 'apply-1', query: { status: 'rejected', reason: '用途不明确' }, body: '' }
    ]);
  });

  it('失败时保留服务端的原因，不弹全局提示', async () => {
    const onError = vi.fn<() => void>();
    configureHttp({ onError });
    server.use(
      mock.post('/backend/api/apply/status/:id', () => HttpResponse.json({ success: false, code: 500, msg: '申请已审核' }))
    );
    await expect(auditApplication({ id: 'apply-1', approved: true, reason: '' })).rejects.toMatchObject({
      kind: 'business',
      message: '申请已审核'
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
