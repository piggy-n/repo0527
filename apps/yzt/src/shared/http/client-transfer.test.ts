import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { http, type TransferProgress } from './client';
import { configureHttp, type HttpHooks } from './configure';
import { readBlobText } from './transfer';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  configureHttp({});
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe('FormData 上传', () => {
  it('上传保留 schema 校验和取消语义', async () => {
    server.use(mock.post('/backend/upload', () => HttpResponse.json({ code: 200, data: null })));
    await expect(http.post('/upload', new FormData(), { schema: z.object({ id: z.string() }) }))
      .rejects.toMatchObject({ kind: 'invalid-response' });
    const controller = new AbortController();
    controller.abort();
    const progress = vi.fn<(progress: TransferProgress) => void>();
    await expect(http.post('/unregistered', new FormData(), {
      schema: z.null(), signal: controller.signal, onUploadProgress: progress
    })).rejects.toMatchObject({ kind: 'canceled' });
    expect(progress).not.toHaveBeenCalled();
  });
});

describe('二进制响应', () => {
  it('postBlob 用 POST、不带正文，同样识别错误信封', async () => {
    const requests: { method: string; body: string }[] = [];
    server.use(
      // 所有方法都接住，用错了方法时是断言失败，不是没有模拟的请求
      mock.all('/backend/download/:id', async ({ request, params }) => {
        requests.push({ method: request.method, body: await request.text() });
        if (params.id === 'missing') {
          return HttpResponse.json({ code: 40000, msg: '文件不存在' });
        }
        return new HttpResponse('内容', { headers: { 'Content-Type': 'application/zip' } });
      })
    );

    const result = await http.postBlob('/download/apply-1');
    expect(result.contentType).toBe('application/zip');
    expect(result.blob.size).toBe(new Blob(['内容']).size);
    await expect(http.postBlob('/download/missing', undefined, { silent: true }))
      .rejects.toMatchObject({ kind: 'business', message: '文件不存在' });
    expect(requests).toEqual([
      { method: 'POST', body: '' },
      { method: 'POST', body: '' }
    ]);
  });

  it('保留文件字节、响应头、查询参数和鉴权，汇报接收进度', async () => {
    // MSW 的 XHR Blob 响应会经过文本解码；非 UTF-8 字节由真实浏览器用例验证
    const bytes = Uint8Array.from([0, 1, 2, 3, 9]);
    configureHttp({ getHeaders: () => ({ token: 'download-token' }) });
    const requests: { key: string | null; token: string | null }[] = [];
    server.use(mock.get('/backend/file', ({ request }) => {
      requests.push({ key: new URL(request.url).searchParams.get('objectKey'), token: request.headers.get('token') });
      return new HttpResponse(bytes, { headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"
      } });
    }));
    const progress = vi.fn<(progress: TransferProgress) => void>();

    const result = await http.getBlob('/file', { query: { objectKey: '目录/文档 +1.pdf' }, onDownloadProgress: progress });

    expect(requests).toEqual([{ key: '目录/文档 +1.pdf', token: 'download-token' }]);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBe(bytes.length);
    expect(result.contentType).toBe('application/pdf');
    expect(result.contentDisposition).toBe("attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf");
    const reader = new FileReader();
    const contents = new Promise(resolve => {
      reader.addEventListener('load', () => resolve(reader.result), { once: true });
    });
    reader.readAsArrayBuffer(result.blob);
    expect(new Uint8Array(await contents as ArrayBuffer)).toEqual(bytes);
    expect(progress).toHaveBeenCalledWith({ loaded: 5, total: 5, percent: 100 });
  });

  it.each(['application/json', 'application/problem+json', 'application/octet-stream', 'text/plain'])(
    '%s 中的失败信封不会被保存为文件', async contentType => {
      const onError = vi.fn<NonNullable<HttpHooks['onError']>>();
      configureHttp({ onError });
      server.use(mock.get('/backend/file', () => new HttpResponse(
        JSON.stringify({ code: 40000, msg: '文件不存在', data: null }),
        { headers: { 'Content-Type': contentType } }
      )));

      await expect(http.getBlob('/file')).rejects.toMatchObject({ kind: 'business', code: 40000, message: '文件不存在' });
      expect(onError).toHaveBeenCalledOnce();
    }
  );

  it.each([200, 401])('HTTP %s 的 401 错误只通知鉴权回调，并保留发出时的凭据', async status => {
    const onUnauthorized = vi.fn<NonNullable<HttpHooks['onUnauthorized']>>();
    const onError = vi.fn<NonNullable<HttpHooks['onError']>>();
    let token = 'old';
    configureHttp({ onUnauthorized, onError, getHeaders: () => ({ token }) });
    server.use(mock.get('/backend/file', () => HttpResponse.json({ code: 401, msg: '登录无效' }, { status })));

    const pending = http.getBlob('/file', { silent: true });
    token = 'new';
    await expect(pending).rejects.toMatchObject({ kind: 'unauthorized', message: '登录状态已过期，请重新登录' });
    expect(onUnauthorized).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unauthorized' }), { headers: { token: 'old' } });
    expect(onError).not.toHaveBeenCalled();
  });

  it('HTTP 失败读取 Blob 中的 msg，silent 只抑制一般错误提示', async () => {
    const onError = vi.fn<NonNullable<HttpHooks['onError']>>();
    configureHttp({ onError });
    server.use(mock.get('/backend/file', () => HttpResponse.json({ msg: '文件读取失败' }, { status: 500 })));

    await expect(http.getBlob('/file', { silent: true }))
      .rejects.toMatchObject({ kind: 'http', status: 500, message: '文件读取失败' });
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['application/json', 'text/html', 'application/octet-stream'])(
    '%s 的异常响应不作为文件返回', async contentType => {
      const body = contentType === 'application/json' ? '{invalid json' : '<!doctype html><html>登录页</html>';
      server.use(mock.get('/backend/file', () => new HttpResponse(body, { headers: { 'Content-Type': contentType } })));
      await expect(http.getBlob('/file')).rejects.toMatchObject({ kind: 'invalid-response' });
    }
  );

  it('有附件声明的 JSON 与普通 TXT 是真实文件，不一律作为错误', async () => {
    server.use(
      mock.get('/backend/json', () => HttpResponse.json({ name: '资料' }, {
        headers: { 'Content-Disposition': 'attachment; filename=data.json' }
      })),
      mock.get('/backend/text', () => HttpResponse.text('正文\n第二行'))
    );
    const signal = new AbortController().signal;
    expect(await readBlobText((await http.getBlob('/json')).blob, signal)).toBe('{"name":"资料"}');
    expect(await readBlobText((await http.getBlob('/text')).blob, signal)).toBe('正文\n第二行');
  });

  it.each([undefined, 'attachment; filename=result.json'])('JSON 成功信封仍不是文件：%s', async disposition => {
    server.use(mock.get('/backend/file', () => HttpResponse.json({ code: 200, data: null }, {
      headers: disposition ? { 'Content-Disposition': disposition } : {}
    })));
    await expect(http.getBlob('/file')).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('过期凭据不发请求；预先取消不通知任何错误回调', async () => {
    const onUnauthorized = vi.fn<NonNullable<HttpHooks['onUnauthorized']>>();
    const onError = vi.fn<NonNullable<HttpHooks['onError']>>();
    configureHttp({ onUnauthorized, onError, isCredentialExpired: () => true });
    await expect(http.getBlob('/unregistered')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    await expect(http.getBlob('/unregistered', { signal: controller.signal })).rejects.toMatchObject({ kind: 'canceled' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('取消正在接收的文件后不再上报进度或错误', async () => {
    const controller = new AbortController();
    const onError = vi.fn<NonNullable<HttpHooks['onError']>>();
    const onUnauthorized = vi.fn<NonNullable<HttpHooks['onUnauthorized']>>();
    configureHttp({ onError, onUnauthorized });
    server.use(mock.get('/backend/file', () => {
      controller.abort();
      return HttpResponse.text('晚到的文件');
    }));
    const onDownloadProgress = vi.fn<(progress: TransferProgress) => void>();
    await expect(http.getBlob('/file', { signal: controller.signal, onDownloadProgress }))
      .rejects.toMatchObject({ kind: 'canceled' });
    expect(onDownloadProgress).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('错误体读取期间取消，不把晚到的 401 报给新会话', async () => {
    const controller = new AbortController();
    const onUnauthorized = vi.fn<NonNullable<HttpHooks['onUnauthorized']>>();
    configureHttp({ onUnauthorized });
    server.use(mock.get('/backend/file', () => HttpResponse.json({ code: 401, msg: '过期' })));
    // oxlint-disable-next-line typescript/unbound-method -- 测试包装原方法，下面显式用 call 绑定当前 FileReader
    const original = FileReader.prototype.readAsText;
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, blob) {
      original.call(this, blob);
      controller.abort();
    });
    await expect(http.getBlob('/file', { signal: controller.signal })).rejects.toMatchObject({ kind: 'canceled' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('文件读取仍受超时约束，网络错误仍是 network', async () => {
    server.use(mock.get('/backend/file', () => new Promise<Response>(() => {})));
    await expect(http.getBlob('/file', { timeout: 5 })).rejects.toMatchObject({ kind: 'timeout' });
    server.use(mock.get('/backend/file', () => HttpResponse.error()));
    await expect(http.getBlob('/file')).rejects.toMatchObject({ kind: 'network' });
  });
});
