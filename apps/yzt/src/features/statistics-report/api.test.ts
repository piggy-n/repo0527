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
  it('POST 正文是名称和分页；状态换算以后原文留着显示，用不到的字段丢弃', async () => {
    const bodies: unknown[] = [];
    server.use(
      mock.post('/backend/statistics/page', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(reportPageResponse([reportRecord()]));
      })
    );
    const page = await fetchReportPage({ name: '基本', pageNum: 1, pageSize: 20 });

    expect(bodies).toEqual([{ name: '基本', pageNum: 1, pageSize: 20 }]);
    expect(page.list).toEqual([
      {
        id: '2117097190761029634',
        name: '基本统计报表_省级',
        year: '2026',
        startTime: '2026-11-02 11:31:28',
        finishTime: '2026-11-02 11:39:28',
        status: 'success',
        statusText: '处理成功'
      }
    ]);
  });

  it('状态只认处理成功、正在处理、处理失败、未处理，文字要完全相同；未处理和其他文字都没有对应的状态', async () => {
    const texts = ['处理成功', '正在处理', '处理失败', '未处理', '处理完成', '正在处理中', '其他状态'];
    server.use(
      mock.post('/backend/statistics/page', () =>
        HttpResponse.json(
          reportPageResponse(texts.map((status, index) => reportRecord({ id: `report-${index}`, status })))
        )
      )
    );
    const page = await fetchReportPage({ name: '', pageNum: 1, pageSize: 20 });

    expect(page.list.map(report => [report.statusText, report.status])).toEqual([
      ['处理成功', 'success'],
      ['正在处理', 'processing'],
      ['处理失败', 'failed'],
      ['未处理', undefined],
      ['处理完成', undefined],
      ['正在处理中', undefined],
      ['其他状态', undefined]
    ]);
  });

  it('没开始、没完成的任务时间是 null：照常解析，不让整页加载失败', async () => {
    server.use(
      mock.post('/backend/statistics/page', () =>
        HttpResponse.json(reportPageResponse([reportRecord({ status: '未处理', startTime: null, finishTime: null })]))
      )
    );

    await expect(fetchReportPage({ name: '', pageNum: 1, pageSize: 20 })).resolves.toMatchObject({
      list: [{ startTime: null, finishTime: null, statusText: '未处理' }]
    });
  });

  it('下载用 GET，长数字 ID 原样放在 query 里；没有文件名时用报表名称加 .zip', async () => {
    const ids: (string | null)[] = [];
    server.use(
      mock.get('/backend/statistics/download', ({ request }) => {
        ids.push(new URL(request.url).searchParams.get('id'));
        return new HttpResponse('内容', { headers: { 'Content-Type': 'application/zip' } });
      })
    );
    const report = { id: '2117097190761029634', name: '基本统计报表_省级' };
    const file = await fetchReportFile(report, new AbortController().signal, () => undefined);

    expect(ids).toEqual(['2117097190761029634']);
    expect(file.fileName).toBe('基本统计报表_省级.zip');
  });

  it('响应头的普通 filename 是百分号编码时，保存的是解码后的中文名称', async () => {
    server.use(
      mock.get('/backend/statistics/download', () => new HttpResponse('内容', {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition':
            'attachment; filename=%E5%9F%BA%E6%9C%AC%E5%8F%98%E5%8C%96%E7%BB%9F%E8%AE%A1%E6%8A%A5%E8%A1%A8_%E5%B8%82%E7%BA%A7.zip'
        }
      }))
    );
    const file = await fetchReportFile({ id: '1', name: '后备名称' }, new AbortController().signal, () => undefined);

    expect(file.fileName).toBe('基本变化统计报表_市级.zip');
  });

  it('下载失败时是返回的错误信封（实测"任务不存在"是 HTTP 200 加 code 40000）', async () => {
    server.use(
      mock.get('/backend/statistics/download', () => HttpResponse.json({ success: false, code: 40000, msg: '任务不存在' }))
    );
    await expect(fetchReportFile({ id: 'missing', name: '报表' }, new AbortController().signal, () => undefined))
      .rejects.toMatchObject({ kind: 'business', message: '任务不存在' });
  });
});
