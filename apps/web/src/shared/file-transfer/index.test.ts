import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchFile, saveFile } from './index';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(() => server.close());

describe('文件读取', () => {
  it('用响应头定名称，只补齐通用类型，不改内容长度', async () => {
    server.use(mock.get('/backend/file', () => new HttpResponse('测试内容', { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': "attachment; filename*=UTF-8''%E6%96%87%E6%A1%A3.txt"
    } })));
    const result = await fetchFile('/file', { fallbackName: '后备.txt', fallbackType: 'text/plain;charset=utf-8' });
    expect(result.fileName).toBe('文档.txt');
    expect(result.blob.type).toBe('text/plain;charset=utf-8');
    expect(result.blob.size).toBe(new Blob(['测试内容']).size);
  });

  it('明确的响应类型保持原样，没有响应名称时使用后备名称', async () => {
    server.use(mock.get('/backend/file', () => new HttpResponse('文件', { headers: { 'Content-Type': 'application/pdf' } })));
    const result = await fetchFile('/file', { fallbackName: '资料.pdf', fallbackType: 'text/plain' });
    expect(result.fileName).toBe('资料.pdf');
    expect(result.blob.type).toBe('application/pdf');
  });

  it('method 为 post 时用 POST 读取', async () => {
    const methods: string[] = [];
    server.use(
      mock.all('/backend/file', ({ request }) => {
        methods.push(request.method);
        return new HttpResponse('文件', { headers: { 'Content-Type': 'application/zip' } });
      })
    );
    await fetchFile('/file', { fallbackName: '数据.zip', method: 'post' });
    await fetchFile('/file', { fallbackName: '数据.zip' });
    expect(methods).toEqual(['POST', 'GET']);
  });

  it('不会通过 MIME 补齐掩盖错误信封', async () => {
    server.use(mock.get('/backend/file', () => HttpResponse.json({ code: 40000, msg: '文件不存在' })));
    await expect(fetchFile('/file', { fallbackName: '资料.pdf', fallbackType: 'application/pdf' }))
      .rejects.toMatchObject({ kind: 'business', message: '文件不存在' });
  });
});

describe('浏览器保存', () => {
  it('点击真实下载链接，移除节点，给浏览器保留读取时间后释放 URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:download-test');
    const revokeObjectURL = vi.fn<(url: string) => void>();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const clicks: { fileName: string; href: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ fileName: this.download, href: this.href, attached: this.isConnected });
    });
    const blob = new Blob(['文档']);

    saveFile({ blob, fileName: '目录/报告.txt' });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([{ fileName: '报告.txt', href: 'blob:download-test', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:download-test');
  });

  it('触发保存失败时立即清理节点和 URL', () => {
    const revokeObjectURL = vi.fn<(url: string) => void>();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:failed', revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('保存失败');
    });
    expect(() => saveFile({ blob: new Blob(), fileName: '资料.txt' })).toThrow('保存失败');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:failed');
  });
});
