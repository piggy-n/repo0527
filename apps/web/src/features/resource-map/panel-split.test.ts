// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ratioForCheckedHeight, splitLists } from './panel-split';

// 可用 500，两边的内容都很多
const overflowing = (ratio: number) => splitLists({ available: 500, tree: 2000, checked: 2000, ratio });

describe('splitLists', () => {
  it('都放得下时按内容：面板跟着变矮，比例不起作用，分割线不能调整（2026-10-16 用户发现收起目录后"已勾选"被截掉）', () => {
    const fits = { tree: 64, checked: 74, adjustable: false };
    expect(splitLists({ available: 600, tree: 64, checked: 74, ratio: 0.4 })).toStrictEqual(fits);
    expect(splitLists({ available: 600, tree: 64, checked: 74, ratio: 0.95 })).toStrictEqual(fits);
    expect(splitLists({ available: 138, tree: 64, checked: 74, ratio: 0.4 })).toStrictEqual(fits);
  });

  it('放不下时按比例分，限制在两边的最小高度以内：目录至少 96，"已勾选"至少 102', () => {
    expect(overflowing(0.4)).toStrictEqual({ tree: 300, checked: 200, adjustable: true });
    expect(overflowing(0.05)).toStrictEqual({ tree: 398, checked: 102, adjustable: true });
    expect(overflowing(0.95)).toStrictEqual({ tree: 96, checked: 404, adjustable: true });
  });

  it('"已勾选"的内容不够分到的高度时仍按比例，下面留白，分割线照常能拖（2026-10-16 用户要求分割线能正常使用）', () => {
    expect(splitLists({ available: 500, tree: 2000, checked: 66, ratio: 0.4 })).toStrictEqual({
      tree: 300,
      checked: 200,
      adjustable: true
    });
  });

  it('目录的内容不够分到的高度时多出的给"已勾选"；目录不比最小高度高时分割线不能调整', () => {
    // 目录收起到 2 行：比例再大，目录也只占 64，剩下的给"已勾选"（它要滚动）
    expect(splitLists({ available: 500, tree: 64, checked: 2000, ratio: 0.4 })).toStrictEqual({
      tree: 64,
      checked: 436,
      adjustable: false
    });
    // 目录 6 行：还能往上拖，让目录滚动
    expect(splitLists({ available: 500, tree: 192, checked: 2000, ratio: 0.4 })).toStrictEqual({
      tree: 192,
      checked: 308,
      adjustable: true
    });
  });

  it('放不下两边的最小高度时只按比例', () => {
    expect(splitLists({ available: 150, tree: 1000, checked: 1000, ratio: 0.4 })).toStrictEqual({
      tree: 90,
      checked: 60,
      adjustable: true
    });
    expect(splitLists({ available: 150, tree: 40, checked: 1000, ratio: 0.4 })).toStrictEqual({
      tree: 40,
      checked: 110,
      adjustable: true
    });
  });
});

describe('ratioForCheckedHeight', () => {
  it('拖到的高度先按两边的最小高度限制，再换成比例；还量不到可用高度时为 null', () => {
    expect(ratioForCheckedHeight(500, 200)).toBe(0.4);
    expect(ratioForCheckedHeight(500, 20)).toBe(102 / 500);
    expect(ratioForCheckedHeight(500, 490)).toBe(404 / 500);
    expect(ratioForCheckedHeight(150, 60)).toBe(0.4);
    expect(ratioForCheckedHeight(0, 60)).toBeNull();
  });
});
