import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForExportFonts } from './image-export';

// jsdom 没有字体集合，保留原描述符以免影响其他用例
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  if (fontsDescriptor) { Object.defineProperty(document, 'fonts', fontsDescriptor); }
  else { Reflect.deleteProperty(document, 'fonts'); }
});

describe('驾驶舱导出字体等待', () => {
  it('字体缺失时允许系统字体导出，但仍等待其他字体完成', async () => {
    let complete: ((faces: FontFace[]) => void) | undefined;
    const pending = new Promise<FontFace[]>(resolve => { complete = resolve; });
    const load = vi.fn<(font: string) => Promise<FontFace[]>>()
      .mockRejectedValueOnce(new DOMException('字体文件不存在', 'NetworkError'))
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce([]);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    const waiting = waitForExportFonts(new AbortController().signal);
    // 先登记拒绝处理，旧实现失败也不会产生未处理的 Promise
    const result = waiting.then(() => 'ready', () => 'failed');
    expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('waiting'), 0))]))
      .toBe('waiting');
    complete!([]);
    expect(await result).toBe('ready');
  });

  it('字体尚未返回时卸载立即结束等待，晚到结果不会恢复导出', async () => {
    let complete: ((faces: FontFace[]) => void) | undefined;
    const pending = new Promise<FontFace[]>(resolve => { complete = resolve; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => pending } });
    const lifetime = new AbortController();
    const waiting = waitForExportFonts(lifetime.signal);
    const result = waiting.then(() => 'ready', error => (error as Error).name);
    lifetime.abort();
    expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('waiting'), 0))]))
      .toBe('AbortError');
    complete!([]);
    expect(await result).toBe('AbortError');
  });
});
