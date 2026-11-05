// @vitest-environment node
import { describe, expect, it } from 'vitest';

const pages = import.meta.glob<string>('./**/*Page.tsx', { query: '?raw', import: 'default', eager: true });

describe('使用底图的页面', () => {
  // 地名图层要求样式有 glyphs，漏传时内网默认的静态底图会让整个视图进入失败（ADR 0133）
  it('把底图注记绑定到分组的页面，都在 provideMap 时传入 BASEMAP_STYLE_ROOT', () => {
    const bound = Object.entries(pages).filter(([, source]) => source.includes('deriveLabelsGroup'));

    expect(bound.length).toBeGreaterThanOrEqual(5);
    expect(bound.filter(([, source]) => !source.includes('root: BASEMAP_STYLE_ROOT')).map(([path]) => path)).toStrictEqual([]);
  });
});
