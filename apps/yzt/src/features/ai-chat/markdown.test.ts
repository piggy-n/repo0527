import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('回答里的表格、加粗和列表转成 HTML', () => {
    const html = renderMarkdown('**主要发现**：\n\n| 编码 | 用地类型 |\n|---|---|\n| 0101 | 水田 |\n\n1. 水田最多');

    expect(html).toContain('<strong>主要发现</strong>');
    expect(html).toContain('<td>0101</td>');
    expect(html).toContain('<ol>');
  });

  it('去掉脚本、事件属性和图片', () => {
    const html = renderMarkdown('<script>alert(1)</script><a href="https://example.com" onclick="x()">链接</a><img src=x>');

    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com">链接</a>');
  });

  it('流式输出到一半的文本也能转换', () => {
    expect(renderMarkdown('| 编码 | 名称 |\n|---')).toContain('编码');
  });
});
