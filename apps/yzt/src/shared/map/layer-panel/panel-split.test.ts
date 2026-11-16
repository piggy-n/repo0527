// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ratioForCheckedHeight, splitLists } from './panel-split';

// 可用 500，两边的内容都很多
const overflowing = (ratio: number) => splitLists({ available: 500, tree: 2000, checked: 2000, ratio });
// 同上，图层标题下面多一行 32 高的标签（三维里的筛选）
const withTabs = (ratio: number) =>
  splitLists({ available: 500, tree: 2000, checked: 2000, ratio, checkedExtra: 32 });

describe('splitLists', () => {
  it('图层收起只保留入口，不按分割线比例占用资源的空间', () => {
    expect(splitLists({ available: 500, tree: 2000, checked: 40, ratio: 0.9, collapsed: true }))
      .toStrictEqual({ tree: 460, checked: 40, adjustable: false });
    expect(splitLists({ available: 500, tree: 64, checked: 40, ratio: 0.1, collapsed: true }))
      .toStrictEqual({ tree: 64, checked: 40, adjustable: false });
  });

  it('都放得下时按内容：面板跟着变矮，比例不起作用，分割线不能调整（2026-10-16 用户发现收起目录后下段被截掉）', () => {
    const fits = { tree: 64, checked: 74, adjustable: false };
    expect(splitLists({ available: 600, tree: 64, checked: 74, ratio: 0.4 })).toStrictEqual(fits);
    expect(splitLists({ available: 600, tree: 64, checked: 74, ratio: 0.95 })).toStrictEqual(fits);
    expect(splitLists({ available: 138, tree: 64, checked: 74, ratio: 0.4 })).toStrictEqual(fits);
  });

  it('放不下时按比例分，限制在两边的最小高度以内：资源至少 208（标题、搜索行、标签行和 3 行），图层至少 112', () => {
    expect(overflowing(0.4)).toStrictEqual({ tree: 300, checked: 200, adjustable: true });
    expect(overflowing(0.05)).toStrictEqual({ tree: 388, checked: 112, adjustable: true });
    expect(overflowing(0.95)).toStrictEqual({ tree: 208, checked: 292, adjustable: true });
  });

  it('图层的内容不够分到的高度时仍按比例，下面留白，分割线照常能拖（2026-10-16 用户要求分割线能正常使用）', () => {
    expect(splitLists({ available: 500, tree: 2000, checked: 66, ratio: 0.4 })).toStrictEqual({
      tree: 300,
      checked: 200,
      adjustable: true
    });
  });

  it('资源的内容不够分到的高度时多出的给图层；资源不比最小高度高时分割线不能调整', () => {
    // 目录收起到 2 行：比例再大，资源也只占 64，剩下的给图层（它要滚动）
    expect(splitLists({ available: 500, tree: 64, checked: 2000, ratio: 0.4 })).toStrictEqual({
      tree: 64,
      checked: 436,
      adjustable: false
    });
    // 资源比最小高度矮 1：不能调整；目录 7 行（比最小高度高）：还能往上拖，让目录滚动
    expect(splitLists({ available: 500, tree: 207, checked: 2000, ratio: 0.4 })).toStrictEqual({
      tree: 207,
      checked: 293,
      adjustable: false
    });
    expect(splitLists({ available: 500, tree: 224, checked: 2000, ratio: 0.4 })).toStrictEqual({
      tree: 224,
      checked: 276,
      adjustable: true
    });
  });

  it('图层标题下面多一行标签（三维里的筛选，ADR 0161）时，图层的最小高度加上这一行，拖到最小仍放得下 2 行', () => {
    expect(withTabs(0.05)).toStrictEqual({ tree: 356, checked: 144, adjustable: true });
    expect(withTabs(0.95)).toStrictEqual({ tree: 208, checked: 292, adjustable: true });
    // 两边的最小高度加起来 352：可用 340 时只按比例
    expect(splitLists({ available: 340, tree: 1000, checked: 1000, ratio: 0.5, checkedExtra: 32 })).toStrictEqual({
      tree: 170,
      checked: 170,
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
    expect(ratioForCheckedHeight(500, 20)).toBe(112 / 500);
    expect(ratioForCheckedHeight(500, 490)).toBe(292 / 500);
    expect(ratioForCheckedHeight(150, 60)).toBe(0.4);
    expect(ratioForCheckedHeight(0, 60)).toBeNull();
  });

  it('图层多一行标签时最小高度跟着加（ADR 0161）', () => {
    expect(ratioForCheckedHeight(500, 20, 32)).toBe(144 / 500);
    expect(ratioForCheckedHeight(500, 490, 32)).toBe(292 / 500);
  });
});
