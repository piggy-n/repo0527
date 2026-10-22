import { effectScope } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useImageExport } from './useImageExport';
import { safeImageName, titleLines } from '../export/image-export';

describe('图片导出生命周期', () => {
  it('同图防重复，卸载后晚到编码结果不交给下载', async () => {
    const scope = effectScope();
    const exporter = scope.run(useImageExport)!;
    const canvas = document.createElement('canvas');
    let complete: BlobCallback | undefined;
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => {
      complete = callback;
    });
    const create = vi.fn<() => Promise<HTMLCanvasElement>>(async () => canvas);
    const first = exporter.run('map', create);
    expect(exporter.pending.value.has('map')).toBe(true);
    expect(await exporter.run('map', create)).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    scope.stop();
    complete?.(new Blob(['test'], { type: 'image/png' }));
    expect(await first).toBeNull();
    expect(exporter.error.value).toBe('');
    expect(exporter.pending.value.size).toBe(0);
  });
  it('失败可重试且不会一直禁用按钮', async () => {
    const scope = effectScope();
    const exporter = scope.run(useImageExport)!;
    await exporter.run('map', () => Promise.reject(new Error('地图尚未就绪')));
    expect(exporter.error.value).toBe('地图尚未就绪');
    const canvas = document.createElement('canvas');
    const blob = new Blob(['test'], { type: 'image/png' });
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(blob));
    expect(await exporter.run('map', async () => canvas)).toBe(blob);
    expect(exporter.error.value).toBe('');
    scope.stop();
  });
  it('长标题按字形宽度换行且文件名保留中文', () => {
    expect(titleLines('江苏省城市体检\n2026', 4, text => text.length)).toEqual(['江苏省城', '市体检', '2026']);
    expect(safeImageName('江苏省/2026:消防救援')).toBe('江苏省-2026-消防救援.png');
  });
});
