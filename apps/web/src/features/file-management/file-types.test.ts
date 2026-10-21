// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filePreviewType, formatFileBytes } from './file-types';
import { fittedPreviewScale } from './docx-preview';

describe('文件预览范围与尺寸', () => {
  it('只接受旧项目格式，忽略扩展名大小写', () => {
    expect(filePreviewType('DOCX')?.kind).toBe('docx');
    expect(filePreviewType('PDF')).toEqual({ kind: 'pdf', mime: 'application/pdf' });
    expect(filePreviewType('txt')?.kind).toBe('text');
    for (const type of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']) {
      expect(filePreviewType(type)?.kind).toBe('image');
    }
    for (const type of ['doc', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'html', 'svg', 'constructor', '']) {
      expect(filePreviewType(type)).toBeUndefined();
    }
  });

  it('适合宽度不放大纸张，用户缩放相对适合宽度计算', () => {
    expect(fittedPreviewScale(1032, 800, 100)).toBe(1);
    expect(fittedPreviewScale(432, 800, 100)).toBe(0.5);
    expect(fittedPreviewScale(432, 800, 150)).toBe(0.75);
    expect(fittedPreviewScale(0, 0, 100)).toBe(1);
  });

  it('字节显示保留数量级', () => {
    expect(formatFileBytes(0)).toBe('0 B');
    expect(formatFileBytes(1536)).toBe('1.5 KB');
    expect(formatFileBytes(2097152)).toBe('2.0 MB');
  });
});
