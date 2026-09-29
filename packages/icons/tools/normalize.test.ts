import { describe, expect, it } from 'vitest';
import { normalizeIcon } from './normalize.ts';

const filled = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" class="icon" data-name="user">
  <title>用户</title>
  <!-- 设计工具导出的注释 -->
  <script>alert(1)</script>
  <path fill="#333333" onclick="alert(2)" d="M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>
  <path style="fill: rgb(89, 126, 247)" d="M4 22a8 8 0 0 1 16 0z"/>
</svg>`;

const stroked = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="#597EF7" stroke-width="2">
  <path d="M2 8h12M8 2v12"/>
</svg>`;

const styled = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <style>.a { fill: #f00; } .b { fill: #0f0; }</style>
  <rect class="a" width="5" height="5"/>
  <rect class="a" x="5" width="5" height="5"/>
  <rect class="b" y="5" width="10" height="5"/>
</svg>`;

const gradient = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <defs>
    <linearGradient id="grad"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>
  </defs>
  <rect width="10" height="10" fill="url(#grad)"/>
</svg>`;

describe('normalizeIcon', () => {
  it('单色图标：颜色改为 currentColor，去掉尺寸、标题、注释、脚本、事件属性和 class', () => {
    const icon = normalizeIcon(filled, 'user', false);

    expect(icon.viewBox).toBe('0 0 24 24');
    expect(icon.body).not.toMatch(/#333|#597ef7|rgb\(/i);
    expect(icon.body).not.toMatch(/<title|<script|onclick|<!--|class=|data-name/);
    expect(icon.svg).not.toMatch(/width=|height=/);
    expect(icon.attrs).toBeUndefined();
  });

  it('只有 width、height 时换算出 viewBox；根元素的描边属性保留到 attrs', () => {
    const icon = normalizeIcon(stroked, 'plus', false);

    expect(icon.viewBox).toBe('0 0 16 16');
    expect(icon.attrs).toEqual({ fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
  });

  it('<style> 中的样式先内联到元素上，再删除 <style>', () => {
    const icon = normalizeIcon(styled, 'blocks-color', true);

    expect(icon.body).not.toContain('<style');
    // SVGO 会把颜色压缩成最短的等价写法，例如 #f00 → red
    expect(icon.body).toMatch(/fill="(#f00|red)"/);
    expect(icon.body).toMatch(/fill="(#0f0|lime)"/);
  });

  it('多色图标保留原色，id 加上图标名前缀避免冲突', () => {
    const icon = normalizeIcon(gradient, 'logo-color', true);

    expect(icon.body).toMatch(/stop-color="(#f00|red)"/);
    expect(icon.body).toMatch(/id="logo-color-\w+"/);
    expect(icon.body).toMatch(/url\(#logo-color-\w+\)/);
  });

  it('同样的输入重复规范化，结果不变', () => {
    for (const [source, name, multicolor] of [
      [filled, 'user', false],
      [stroked, 'plus', false],
      [styled, 'blocks-color', true],
      [gradient, 'logo-color', true]
    ] as const) {
      const once = normalizeIcon(source, name, multicolor);
      const twice = normalizeIcon(once.svg, name, multicolor);

      expect(twice).toEqual(once);
    }
  });

  it('没有 viewBox 也没有尺寸时报错', () => {
    expect(() => normalizeIcon('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>', 'bad', false)).toThrow(
      'bad：缺少 viewBox'
    );
  });
});
