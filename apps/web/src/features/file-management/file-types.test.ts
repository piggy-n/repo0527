// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filePreviewType, formatFileBytes } from './file-types';

describe('文件预览范围与尺寸', () => {
  it('只预览文档和文本，忽略扩展名大小写；图片仅下载', () => {
    expect(filePreviewType('DOCX')?.kind).toBe('docx');
    expect(filePreviewType('PDF')).toEqual({ kind: 'pdf', mime: 'application/pdf' });
    expect(filePreviewType('txt')?.kind).toBe('text');
    for (const type of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']) {
      expect(filePreviewType(type)).toBeUndefined();
    }
    for (const type of ['doc', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'html', 'svg', 'constructor', '']) {
      expect(filePreviewType(type)).toBeUndefined();
    }
  });

  it('字节显示保留数量级', () => {
    expect(formatFileBytes(0)).toBe('0 B');
    expect(formatFileBytes(1536)).toBe('1.5 KB');
    expect(formatFileBytes(2097152)).toBe('2.0 MB');
  });
});
