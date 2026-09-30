import { describe, expect, it } from 'vitest';
import sassEntry from './_index.scss?raw';
import { COMPACT_BREAKPOINT, COMPACT_MEDIA_QUERY } from './breakpoints';

describe('窄屏断点', () => {
  it('Sass 入口的 $compact 与 TS 常量一致', () => {
    const match = /^\$compact:\s*(\d+)px;/m.exec(sassEntry);
    expect(Number(match?.[1])).toBe(COMPACT_BREAKPOINT);
  });

  it('媒体查询用区间写法，与 Sass 中的写法相同', () => {
    expect(COMPACT_MEDIA_QUERY).toBe('(width < 1200px)');
  });
});
