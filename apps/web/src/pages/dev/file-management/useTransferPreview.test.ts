// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import { canPreviewSample, useDocumentPreview, useDownloadPreview, type PreviewSample } from './useTransferPreview';

const sample: PreviewSample = { id: 'one', name: '说明.docx', type: 'docx', year: '2026', tag: '综合' };
const scopes: EffectScope[] = [];

/** 独立作用域确保测试结束时模拟任务已释放 */
function setup<T>(create: () => T): T {
  vi.useFakeTimers();
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(create)!;
}

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  vi.useRealTimers();
});

describe('下载与预览原型边界', () => {
  it('只提供旧项目支持格式的预览入口', () => {
    for (const type of ['DOCX', 'pdf', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']) {
      expect(canPreviewSample({ ...sample, type })).toBe(true);
    }
    for (const type of ['doc', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'html', 'svg']) {
      expect(canPreviewSample({ ...sample, type })).toBe(false);
    }
  });

  it('下载同一文件防重复，取消一项不影响其他项', () => {
    const model = setup(useDownloadPreview);
    model.start(sample);
    model.start(sample);
    model.start({ ...sample, id: 'two' });
    expect(model.tasks.value).toHaveLength(2);
    const first = model.tasks.value.find(task => task.file.id === 'one')!;
    vi.advanceTimersByTime(1200);
    model.cancel(first);
    vi.advanceTimersByTime(6000);
    expect(first.phase).toBe('cancelled');
    expect(first.received).toBe(20);
    expect(model.tasks.value[0]?.phase).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('未知总量不生成百分比语义，失败可重新开始，清理不移除进行中项', () => {
    const model = setup(useDownloadPreview);
    model.scene.value = 'error';
    model.start(sample);
    vi.advanceTimersByTime(6000);
    expect(model.tasks.value[0]?.phase).toBe('error');
    model.scene.value = 'unknown';
    model.start(sample);
    model.clearFinished();
    expect(model.tasks.value[0]).toMatchObject({ phase: 'receiving', received: 0, unknown: true });
    vi.advanceTimersByTime(6000);
    expect(model.tasks.value[0]?.phase).toBe('done');
    model.clearFinished();
    expect(model.tasks.value).toEqual([]);
  });

  it('接收后的检查仍算进行中，清除已结束只保留接收和检查，可分别取消', () => {
    const model = setup(useDownloadPreview);
    model.showStates(sample);
    expect(model.tasks.value).toHaveLength(6);
    expect(model.isReceiving('demo-checking')).toBe(true);
    model.clearFinished();
    expect(model.tasks.value.map(task => task.phase)).toEqual(['receiving', 'receiving', 'checking']);
    model.cancel(model.tasks.value[2]);
    expect(model.isReceiving('demo-checking')).toBe(false);
    model.clearAll();
    expect(model.tasks.value).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('关闭中止预览；快速重开不被上一轮失败覆盖', () => {
    const model = setup(useDocumentPreview);
    model.scene.value = 'render-error';
    model.open(sample);
    vi.advanceTimersByTime(1200);
    model.close();
    expect(model.file.value).toBeNull();
    expect(model.visible.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    model.scene.value = 'success';
    model.open({ ...sample, id: 'two', type: 'txt' });
    vi.advanceTimersByTime(600);
    expect(model.phase.value).toBe('reading');
    vi.advanceTimersByTime(1200);
    expect(model.phase.value).toBe('ready');
    expect(model.file.value?.id).toBe('two');
  });

  it('读取失败可以重试，不支持的文件作废上一轮预览', () => {
    const model = setup(useDocumentPreview);
    model.scene.value = 'error';
    model.open(sample);
    vi.advanceTimersByTime(1200);
    expect(model.failure.value).toBe('文件读取失败，请重试');
    model.retry();
    vi.advanceTimersByTime(1800);
    expect(model.phase.value).toBe('ready');
    model.open({ ...sample, type: 'xlsx' });
    expect(model.visible.value).toBe(false);
    expect(model.file.value).toBeNull();
  });

  it('离开原型页面清理所有下载与预览计时器', () => {
    const downloads = setup(useDownloadPreview);
    const preview = setup(useDocumentPreview);
    downloads.scene.value = 'waiting';
    downloads.start(sample);
    preview.open(sample);
    scopes.forEach(scope => scope.stop());
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(8000);
    expect(preview.phase.value).toBe('reading');
    expect(downloads.tasks.value[0]?.received).toBe(0);
  });
});
