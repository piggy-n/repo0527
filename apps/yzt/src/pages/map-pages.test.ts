// @vitest-environment node
import { describe, expect, it } from 'vitest';

const pages = import.meta.glob<string>('./**/*Page.tsx', { query: '?raw', import: 'default', eager: true });

describe('使用底图的页面', () => {
  // 地名图层要求样式有 glyphs，漏传时内网默认的静态底图会让整个视图进入失败（ADR 0133）
  it('业务地图页都把偏好的范围交给底图：标注的显隐在页面之间共用（ADR 0146）；开发页不存偏好', () => {
    const business = Object.entries(pages).filter(
      ([path, source]) => source.includes('useBasemap(') && !path.includes('/dev/')
    );

    expect(business.length).toBeGreaterThanOrEqual(5);
    expect(business.filter(([, source]) => !source.includes('usePreferenceScope()')).map(([path]) => path)).toStrictEqual([]);
  });

  it('把底图注记绑定到分组的页面，都在 provideMap 时传入 BASEMAP_STYLE_ROOT', () => {
    const bound = Object.entries(pages).filter(([, source]) => source.includes('deriveLabelsGroup'));

    expect(bound.length).toBeGreaterThanOrEqual(5);
    expect(bound.filter(([, source]) => !source.includes('root: BASEMAP_STYLE_ROOT')).map(([path]) => path)).toStrictEqual([]);
  });
});
