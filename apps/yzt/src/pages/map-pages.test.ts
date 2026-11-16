// @vitest-environment node
import { describe, expect, it } from 'vitest';

const pages = import.meta.glob<string>('./**/*Page.tsx', { query: '?raw', import: 'default', eager: true });
// 页面目录下所有调用 provideMap 的组件（开发页的地图组件不一定叫 *Page，如 dev/splat-watch/SplatWatchMap.tsx）
const components = import.meta.glob<string>(['./**/*.tsx', '!./**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true
});

// provideMap 调用的参数对象：从它的左花括号数到配对的右花括号
function provideMapOptions(source: string): string[] {
  const calls: string[] = [];
  let from = source.indexOf('provideMap(');
  while (from !== -1) {
    const open = source.indexOf('{', from);
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
      if (depth === 0) {
        break;
      }
    }
    calls.push(source.slice(open, end + 1));
    from = source.indexOf('provideMap(', end);
  }
  return calls;
}

describe('使用底图的页面', () => {
  it('业务地图页都把偏好的范围交给底图：标注的显隐在页面之间共用（ADR 0146）；开发页不存偏好', () => {
    const business = Object.entries(pages).filter(
      ([path, source]) => source.includes('useBasemap(') && !path.includes('/dev/')
    );

    expect(business.length).toBeGreaterThanOrEqual(5);
    expect(business.filter(([, source]) => !source.includes('usePreferenceScope()')).map(([path]) => path)).toStrictEqual([]);
  });

  // 地图文字用页面已加载的普惠体在本地画，样式不写 glyphs（ADR 0160，取代 ADR 0133 第 3 节的 BASEMAP_STYLE_ROOT）：
  // 写了 glyphs 时数字、拉丁字母会去请求字形文件，部署里没有这些文件。原来的写法是共享常量里写 glyphs、页面只传 root，
  // 所以检查 provideMap 不传 root，而不只是在页面里找 glyphs
  it('地图页（包括开发页的地图组件）的 provideMap 都不传样式根属性 root，页面里也不写 glyphs', () => {
    const calls = Object.entries(components).flatMap(([path, source]) =>
      provideMapOptions(source).map(options => [path, options] as const)
    );
    const withRoot = calls.filter(([, options]) => /\broot\s*:/.test(options)).map(([path]) => path);
    const withGlyphs = Object.entries(components)
      .filter(([, source]) => /\bglyphs\s*:/.test(source))
      .map(([path]) => path);

    expect(calls.length).toBeGreaterThanOrEqual(8);
    expect(calls.map(([path]) => path)).toContain('./dev/splat-watch/SplatWatchMap.tsx');
    expect(withRoot).toStrictEqual([]);
    expect(withGlyphs).toStrictEqual([]);
  });
});
