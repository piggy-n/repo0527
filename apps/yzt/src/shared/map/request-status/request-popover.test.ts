// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ViewportBox } from '../layer-panel/popover-placement';
import { type RequestPopoverInput, requestPopoverPlacement } from './request-popover';

const box = (left: number, top: number, right: number, bottom: number): ViewportBox => ({ left, top, right, bottom });

// 1280×800 的窗口，顶栏 56，地图四周留白 16：地图区域是 (16, 72)～(1264, 784)，状态栏的上边在 760。
// 面板展开着、到了列的底部
const WIDE: RequestPopoverInput = {
  panel: box(16, 72, 336, 748),
  collapsed: false,
  area: box(16, 72, 1264, 784),
  barTop: 760,
  viewport: { height: 800 }
};

describe('requestPopoverPlacement', () => {
  it('面板下面放不下时贴着面板的右边，底边在状态栏上方 8，最高 420，和面板同宽', () => {
    expect(requestPopoverPlacement(WIDE)).toStrictEqual({
      side: 'beside',
      left: 344,
      bottom: 48,
      width: 320,
      maxHeight: 420
    });
  });

  it('面板下面到状态栏上方放得下 420 时在面板下方，和面板左对齐、同宽；差 1 像素也放到右边', () => {
    // 面板底边 324：324 + 8 + 420 = 752 = 760 - 8
    const fits = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 336, 324) });
    expect(fits).toStrictEqual({ side: 'below', left: 16, top: 332, width: 320, maxHeight: 420 });
    const short = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 336, 325) });
    expect(short).toMatchObject({ side: 'beside', left: 344, bottom: 48 });
  });

  it('面板收起成竖条时用面板展开时的宽度：竖条矮，在它下方；放不下时在它右边', () => {
    const strip = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 56, 212), collapsed: true });
    expect(strip).toStrictEqual({ side: 'below', left: 16, top: 220, width: 320, maxHeight: 420 });
    const low = requestPopoverPlacement({
      ...WIDE,
      panel: box(16, 72, 56, 212),
      collapsed: true,
      area: box(16, 72, 1264, 560),
      barTop: 536,
      viewport: { height: 576 }
    });
    expect(low).toMatchObject({ side: 'beside', left: 64, width: 320 });
  });

  it('面板变窄时宽度、右边跟着面板走，底边不变', () => {
    const narrow = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 256, 748) });
    expect(narrow).toMatchObject({ side: 'beside', left: 264, bottom: 48, width: 240 });
  });

  it('右边放不下时向左移、盖住面板；区域比面板窄时和区域同宽', () => {
    // 手机宽度展开着面板：面板几乎占满区域
    const phone = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 303, 748), area: box(16, 72, 359, 784) });
    expect(phone).toMatchObject({ side: 'beside', left: 72, width: 287 });
    const tiny = requestPopoverPlacement({
      ...WIDE,
      panel: box(16, 72, 300, 212),
      collapsed: true,
      area: box(16, 72, 216, 784)
    });
    expect(tiny).toMatchObject({ side: 'below', left: 16, width: 200 });
  });

  it('区域上边放不下 420 时变矮，再矮也不是负数', () => {
    const low = requestPopoverPlacement({ ...WIDE, area: box(16, 72, 1264, 440), barTop: 416, viewport: { height: 456 } });
    expect(low).toMatchObject({ side: 'beside', bottom: 48, maxHeight: 336 });
    const flat = requestPopoverPlacement({ ...WIDE, area: box(16, 72, 1264, 80), barTop: 76, viewport: { height: 96 } });
    expect(flat.maxHeight).toBe(0);
  });

  it('量不到面板时贴着区域的左边，宽度同面板展开时', () => {
    expect(requestPopoverPlacement({ ...WIDE, panel: null })).toMatchObject({ side: 'beside', left: 16, width: 320 });
  });
});
