// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { iconMarkup } from './icon-image';

describe('图标的 SVG 文本', () => {
  it('写上尺寸，根元素的属性与 SvgIcon 相同，注册表里的 fill 覆盖默认的 currentColor', () => {
    const markup = iconMarkup('dashboard-compass-color', 96);
    expect(markup).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 48 48" width="96" height="96" /);
    const root = markup.slice(0, markup.indexOf('>'));
    expect(root.match(/ fill="[^"]*"/g)).toEqual([' fill="none"']);
    expect(markup).toContain('<path fill="#1674e8"');
  });

  it('单色图标的 currentColor 取 color', () => {
    expect(iconMarkup('arrow-left', 24, '#0E4894')).toContain(' color="#0E4894" fill="none" stroke="currentColor"');
  });
});
