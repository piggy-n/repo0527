import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { DEFAULT_CATEGORY_ID } from '@/features/file-management/categories';
import { useUploadPreview } from './useUploadPreview';

afterEach(() => vi.useRealTimers());

/** 用原型已有的模拟时钟验证关闭与任务快照的边界 */
function setupPreview() {
  vi.useFakeTimers();
  const completed = vi.fn<Parameters<typeof useUploadPreview>[0]>();
  const scope = effectScope();
  const model = scope.run(() => useUploadPreview(completed))!;
  model.open('policy-law-national');
  model.fields.year = '2025';
  model.fields.tag = '综合';
  model.fields.remark = '本次备注';
  const file = new File(['测试内容'], '测试.txt');
  model.addFiles([file]);
  return { model, completed, file, scope };
}

describe('上传原型关闭规则', () => {
  it('关闭清空文件及填写，再打开使用当前分类与默认年份', () => {
    const { model, scope } = setupPreview();
    try {
      model.close();
      expect(model.files.value).toEqual([]);
      expect(model.fields).toEqual({
        categoryId: DEFAULT_CATEGORY_ID, year: String(new Date().getFullYear()), tag: '', remark: ''
      });
      expect(model.visible.value).toBe(false);
      model.open('government-document-notice');
      expect(model.fields.categoryId).toBe('government-document-notice');
      expect(model.files.value).toEqual([]);
    } finally {
      scope.stop();
    }
  });

  it('已发出的任务用独立快照完成，关闭后不恢复草稿或重复提交', () => {
    const { model, completed, file, scope } = setupPreview();
    try {
      model.submit();
      model.close();
      expect(model.busy.value).toBe(true);
      expect(model.files.value).toEqual([]);
      expect(model.fields.tag).toBe('');
      model.open(DEFAULT_CATEGORY_ID);
      expect(model.progressOnly.value).toBe(true);
      model.submit();
      vi.advanceTimersByTime(3000);
      expect(completed).toHaveBeenCalledExactlyOnceWith([file], { files: [file], year: '2025', tag: '综合' });
      model.close();
      model.open(DEFAULT_CATEGORY_ID);
      expect(model.phase.value).toBe('draft');
      expect(model.files.value).toEqual([]);
    } finally {
      scope.stop();
    }
  });

  it('失败在窗口打开时保留输入供重试，关闭后清空', () => {
    const { model, completed, scope } = setupPreview();
    try {
      model.result.value = 'error';
      model.submit();
      vi.advanceTimersByTime(3000);
      expect(model.phase.value).toBe('error');
      expect(model.files.value).toHaveLength(1);
      expect(completed).not.toHaveBeenCalled();
      model.close();
      expect(model.files.value).toEqual([]);
      expect(model.fields.remark).toBe('');
      expect(model.phase.value).toBe('draft');
    } finally {
      scope.stop();
    }
  });
});
