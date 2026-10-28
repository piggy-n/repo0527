// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSystemManagementDemo } from './useSystemManagementDemo';

afterEach(() => {
  vi.useRealTimers();
});

describe('useSystemManagementDemo', () => {
  it('筛选点"查询"才生效，换条件回到第 1 页；重置清空条件', () => {
    const demo = useSystemManagementDemo();
    const all = demo.audit.total.value;
    demo.audit.pager.pageNum.value = 2;

    demo.audit.form.status = 'pending';
    expect(demo.audit.total.value).toBe(all);
    demo.audit.search();
    expect(demo.audit.total.value).toBe(2);
    expect(demo.audit.pager.pageNum.value).toBe(1);

    demo.audit.reset();
    expect(demo.audit.form.status).toBe('');
    expect(demo.audit.total.value).toBe(all);
  });

  it('审核：失败时保留待审核；通过后开始准备数据', async () => {
    vi.useFakeTimers();
    const demo = useSystemManagementDemo();
    await demo.open('apply-001');
    expect(demo.review.mode.value).toBe('audit');

    demo.submitScene.value = 'error';
    const failed = demo.review.submit();
    await vi.advanceTimersByTimeAsync(400);
    expect(await failed).toEqual({ kind: 'error', message: '审核提交失败，请重试' });
    expect(demo.review.application.value?.status).toBe('pending');

    demo.submitScene.value = 'success';
    const done = demo.review.submit();
    expect(demo.review.pending.value).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(await done).toEqual({ kind: 'success', id: 'apply-001', approved: true });
    expect(demo.review.application.value).toMatchObject({ status: 'approved', prepare: 'processing' });
    expect(demo.review.mode.value).toBe('view');
  });

  it('下载：进度每次涨 20%，同一行不重复开始', async () => {
    vi.useFakeTimers();
    const { downloads } = useSystemManagementDemo();
    const done = downloads.start('apply-004');
    expect(await downloads.start('apply-004')).toBe(false);
    expect(downloads.state.percentOf('apply-004')).toBe(0);

    await vi.advanceTimersByTimeAsync(600);
    expect(downloads.state.percentOf('apply-004')).toBe(40);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await done).toBe(true);
    expect(downloads.state.isDownloading('apply-004')).toBe(false);
  });
});
