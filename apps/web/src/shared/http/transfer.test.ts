import type { AxiosProgressEvent } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { baseMimeType, progressReporter, readBlobText, type TransferProgress } from './transfer';

describe('传输进度', () => {
  it('已知总量给出真实百分比，未知总量或零总量不伪造百分比', () => {
    const received = vi.fn<(progress: TransferProgress) => void>();
    const report = progressReporter(received, () => true);
    const event: AxiosProgressEvent = { loaded: 20, total: 80, bytes: 20, lengthComputable: true };
    report?.(event);
    report?.({ ...event, loaded: 100 });
    report?.({ loaded: 20, bytes: 20, lengthComputable: false });
    report?.({ ...event, total: 0 });

    expect(received.mock.calls).toEqual([
      [{ loaded: 20, total: 80, percent: 25 }],
      [{ loaded: 100, total: 80, percent: 100 }],
      [{ loaded: 20, total: null, percent: null }],
      [{ loaded: 20, total: null, percent: null }]
    ]);
  });

  it('百分比是向下取整的整数：界面直接显示，差一点没传完时不是 100', () => {
    const received = vi.fn<(progress: TransferProgress) => void>();
    const report = progressReporter(received, () => true);
    const event: AxiosProgressEvent = { loaded: 1, total: 3, bytes: 1, lengthComputable: true };
    report?.(event);
    report?.({ ...event, loaded: 2 });
    report?.({ ...event, loaded: 2999, total: 3000 });
    report?.({ ...event, loaded: 3000, total: 3000 });

    expect(received.mock.calls.map(([progress]) => progress.percent)).toEqual([33, 66, 99, 100]);
  });

  it('结束后的进度不再通知，使用方抛错也不打断传输', () => {
    let active = true;
    const callback = vi.fn<() => void>(() => {
      throw new Error('界面回调失败');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = progressReporter(callback, () => active);
      const event = { loaded: 1, bytes: 1, lengthComputable: false };
      expect(() => report?.(event)).not.toThrow();
      active = false;
      report?.(event);
      expect(callback).toHaveBeenCalledOnce();
      expect(logged).toHaveBeenCalledOnce();
      expect(progressReporter(undefined, () => true)).toBeUndefined();
    } finally {
      logged.mockRestore();
    }
  });
});

describe('错误体读取', () => {
  it('读取 UTF-8 内容，结束时释放取消监听', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    expect(await readBlobText(new Blob(['文件不存在']), controller.signal)).toBe('文件不存在');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('读取期间取消和预先取消都拒绝结果', async () => {
    const controller = new AbortController();
    const pending = readBlobText(new Blob(['内容']), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readBlobText(new Blob(['内容']), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('baseMimeType', () => {
  it('去掉参数和空白，统一小写；没有类型时是空字符串', () => {
    expect(baseMimeType('Application/JSON; charset=UTF-8')).toBe('application/json');
    expect(baseMimeType(' text/plain ')).toBe('text/plain');
    expect(baseMimeType('')).toBe('');
  });
});
