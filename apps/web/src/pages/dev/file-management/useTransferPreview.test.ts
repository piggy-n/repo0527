// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import { canPreviewSample, type PreviewSample, useDownloadSample, usePreviewSample } from './useTransferPreview';

const sample: PreviewSample = { id: 'one', objectKey: 'one', name: '说明.txt', type: 'txt', year: '2026', tag: '综合' };
const scopes: EffectScope[] = [];

/** 每个模型在自己的作用域里创建，用例结束时停止作用域，模拟计时器也随之清掉 */
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

describe('文件管理样例的演示模型', () => {
  it('预览范围和正式页一致：文档和图片可预览，其他格式只下载', () => {
    for (const type of ['DOCX', 'pdf', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']) {
      expect(canPreviewSample({ type })).toBe(true);
    }
    for (const type of ['doc', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'html', 'svg']) {
      expect(canPreviewSample({ type })).toBe(false);
    }
  });

  it('下载同一文件防重复，取消一项不影响其他项', () => {
    const model = setup(useDownloadSample);
    void model.start(sample);
    void model.start(sample);
    void model.start({ ...sample, id: 'two' });
    expect(model.tasks.value).toHaveLength(2);
    const first = model.tasks.value.find(task => task.file.id === 'one')!;
    vi.advanceTimersByTime(1200);
    model.cancel(first);
    vi.advanceTimersByTime(6000);
    expect(first.phase).toBe('canceled');
    expect(first.progress?.percent).toBe(20);
    expect(model.tasks.value[0]?.phase).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('总量未知时不给百分比；失败可以重新开始，清除已结束时保留进行中的', () => {
    const model = setup(useDownloadSample);
    model.scene.value = 'error';
    void model.start(sample);
    vi.advanceTimersByTime(6000);
    expect(model.tasks.value[0]).toMatchObject({ phase: 'error', failure: '下载失败，请重试' });
    model.scene.value = 'unknown';
    void model.start(sample);
    model.clearFinished();
    vi.advanceTimersByTime(600);
    expect(model.tasks.value[0]).toMatchObject({ phase: 'receiving', progress: { total: null, percent: null } });
    vi.advanceTimersByTime(6000);
    expect(model.tasks.value[0]?.phase).toBe('done');
    model.clearFinished();
    expect(model.tasks.value).toEqual([]);
  });

  it('一次列出全部状态；检查中仍算进行中，可以取消', () => {
    const model = setup(useDownloadSample);
    model.showStates(sample);
    expect(model.tasks.value.map(task => task.phase)).toEqual([
      'receiving',
      'receiving',
      'checking',
      'error',
      'done',
      'canceled'
    ]);
    expect(model.isDownloading('demo-checking')).toBe(true);
    model.clearFinished();
    expect(model.tasks.value.map(task => task.phase)).toEqual(['receiving', 'receiving', 'checking']);
    model.cancel(model.tasks.value[2]);
    expect(model.isDownloading('demo-checking')).toBe(false);
    model.clearAll();
    expect(model.tasks.value).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('关闭中止预览；快速重开不被上一轮的失败覆盖', async () => {
    const model = setup(usePreviewSample);
    model.scene.value = 'error';
    const first = model.open(sample);
    model.close();
    await vi.advanceTimersByTimeAsync(1200);
    await first;
    expect(model.file.value).toBeNull();
    expect(model.visible.value).toBe(false);
    model.scene.value = 'success';
    const second = model.open({ ...sample, id: 'two' });
    await vi.advanceTimersByTimeAsync(600);
    expect(model.phase.value).toBe('reading');
    await vi.advanceTimersByTimeAsync(600);
    await second;
    expect(model.phase.value).toBe('ready');
    expect(model.content.value).toMatchObject({ kind: 'text' });
    expect(model.file.value?.id).toBe('two');
  });

  it('读取失败可以重试；不支持的格式直接说明只能下载', async () => {
    const model = setup(usePreviewSample);
    model.scene.value = 'error';
    const failed = model.open(sample);
    await vi.advanceTimersByTimeAsync(1200);
    await failed;
    expect(model.failure.value).toBe('文件读取失败，请重试');
    const retried = model.retry();
    await vi.advanceTimersByTimeAsync(1200);
    await retried;
    expect(model.phase.value).toBe('ready');
    await model.open({ ...sample, type: 'xlsx' });
    expect(model.phase.value).toBe('error');
    expect(model.failure.value).toContain('下载');
  });

  it('显示失败一次：内容交给阅读区后报告失败', async () => {
    const model = setup(usePreviewSample);
    model.scene.value = 'render-error';
    const pending = model.open(sample);
    await vi.advanceTimersByTimeAsync(1200);
    await pending;
    expect(model.phase.value).toBe('error');
    expect(model.content.value).toBeNull();
  });

  it('离开样例页面时清掉全部下载和预览的计时器', () => {
    const downloads = setup(useDownloadSample);
    const preview = setup(usePreviewSample);
    downloads.scene.value = 'waiting';
    void downloads.start(sample);
    void preview.open(sample);
    scopes.forEach(scope => scope.stop());
    expect(vi.getTimerCount()).toBe(0);
  });
});
