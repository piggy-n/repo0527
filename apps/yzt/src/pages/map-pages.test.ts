// @vitest-environment node
import { describe, expect, it } from 'vitest';

const pages = import.meta.glob<string>('./**/*Page.tsx', { query: '?raw', import: 'default', eager: true });

describe('使用底图的页面', () => {
  it('业务地图页都把偏好的范围交给底图：标注的显隐在页面之间共用（ADR 0146）；开发页不存偏好', () => {
    const business = Object.entries(pages).filter(
      ([path, source]) => source.includes('useBasemap(') && !path.includes('/dev/')
    );

    expect(business.length).toBeGreaterThanOrEqual(5);
    expect(business.filter(([, source]) => !source.includes('usePreferenceScope()')).map(([path]) => path)).toStrictEqual([]);
  });

  // 地图文字用页面已加载的普惠体在本地画，样式不写 glyphs（ADR 0160，取代 ADR 0133 第 3 节的 BASEMAP_STYLE_ROOT）：
  // 写了 glyphs 时数字、拉丁字母会去请求字形文件，部署里没有这些文件
  it('地图页（包括开发页）都不给样式写 glyphs', () => {
    const bound = Object.entries(pages).filter(([, source]) => source.includes('deriveLabelsGroup'));
    const withGlyphs = Object.entries(pages).filter(([, source]) => /\bglyphs\s*:/.test(source));

    expect(bound.length).toBeGreaterThanOrEqual(5);
    expect(withGlyphs.map(([path]) => path)).toStrictEqual([]);
  });
});
