// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { safeReporter } from './report';

describe('safeReporter', () => {
  it('把错误交给报告器', () => {
    const report = vi.fn<(error: unknown) => void>();
    const failure = new Error('瓦片 404');

    safeReporter(report, 'test')(failure);

    expect(report).toHaveBeenCalledWith(failure);
  });

  it('报告器自己抛错时不往外抛，改为打印到控制台，原始错误不丢', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const reporterError = new Error('报告器出错');
      const failure = new Error('瓦片 404');
      const reportSafely = safeReporter(() => {
        throw reporterError;
      }, 'test');

      expect(() => reportSafely(failure)).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('[test] 错误报告器抛出了异常', reporterError, failure);
    } finally {
      consoleError.mockRestore();
    }
  });
});
