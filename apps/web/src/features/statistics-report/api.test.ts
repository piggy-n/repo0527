import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchReportFile, fetchReportPage } from './api';
import { reportPageResponse, reportRecord } from './test-data';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('统计报表', () => {
  it('POST 正文是名称和分页；年份统一成字符串，没见过的状态原样保留', async () => {
    const bodies: unknown[] = [];
    server.use(
      mock.post('/backend/statistics/page', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(reportPageResponse([reportRecord(), reportRecord({ id: 'report-2', status: '已完成' })]));
      })
    );
    const page = await fetchReportPage({ name: '基本', pageNum: 1, pageSize: 20 });

    expect(bodies).toEqual([{ name: '基本', pageNum: 1, pageSize: 20 }]);
    expect(page.list).toEqual([
      {
        id: 'report-1',
        name: '基本统计报表_省级',
        year: '2024',
        startTime: '2026-10-14 14:20:00',
        finishTime: '2026-10-14 14:23:45',
        status: 'success'
      },
      {
        id: 'report-2',
        name: '基本统计报表_省级',
        year: '2024',
        startTime: '2026-10-14 14:20:00',
        finishTime: '2026-10-14 14:23:45',
        status: '已完成'
      }
    ]);
  });

  it('下载用 GET，ID 在 query 里；没有文件名时用报表名称加 .zip', async () => {
    const ids: (string | null)[] = [];
    server.use(
      mock.get('/backend/statistics/download', ({ request }) => {
        ids.push(new URL(request.url).searchParams.get('id'));
        return new HttpResponse('内容', { headers: { 'Content-Type': 'application/zip' } });
      })
    );
    const report = { id: 'report-1', name: '基本统计报表_省级' };
    const file = await fetchReportFile(report, new AbortController().signal, () => undefined);

    expect(ids).toEqual(['report-1']);
    expect(file.fileName).toBe('基本统计报表_省级.zip');
  });

  it('下载失败时是返回的错误信封（实测"任务不存在"是 HTTP 200 加 code 40000）', async () => {
    server.use(
      mock.get('/backend/statistics/download', () => HttpResponse.json({ success: false, code: 40000, msg: '任务不存在' }))
    );
    await expect(fetchReportFile({ id: 'missing', name: '报表' }, new AbortController().signal, () => undefined))
      .rejects.toMatchObject({ kind: 'business', message: '任务不存在' });
  });
});
