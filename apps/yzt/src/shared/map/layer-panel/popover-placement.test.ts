// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { layerPopoverPlacement, type PopoverPlacementInput, type ViewportBox } from './popover-placement';

const box = (top: number, bottom: number, left = 16, right = 336): ViewportBox => ({ top, bottom, left, right });

const PANEL = box(56, 860);
const LIST = box(480, 840);
const VIEWPORT = { width: 1440, height: 900 };

// 面板、滚动区、视口取上面的，行和浮层的高度由用例给出
const place = (anchor: ViewportBox, height: number, changes: Partial<PopoverPlacementInput> = {}) =>
  layerPopoverPlacement({ panel: PANEL, anchor, list: LIST, viewport: VIEWPORT, height, ...changes });

describe('layerPopoverPlacement', () => {
  it('在面板右边 10，箭头对准选中行的中线', () => {
    const placement = place(box(600, 632), 300);

    expect(placement.left).toBe(346);
    expect(placement.top + placement.arrowTop).toBe(616);
    expect(placement.maxHeight).toBe(560);
  });

  it('浮层放不下时贴着视口的下边，箭头跟着行走，离上下边至少 14', () => {
    const placement = place(box(800, 832), 300);

    expect(placement.top).toBe(900 - 16 - 300);
    expect(placement.top + placement.arrowTop).toBe(816);

    const low = place(box(860, 892), 300, { list: box(480, 900) });
    expect(low.arrowTop).toBe(300 - 14);
  });

  it('行滚出滚动区：箭头停在滚动区边上', () => {
    const above = place(box(300, 332), 200);
    expect(above.top + above.arrowTop).toBe(490);

    const below = place(box(1000, 1032), 200);
    expect(below.top + below.arrowTop).toBe(830);
  });

  it('内容比视口高：最高 560，矮屏时到视口减去上下 16，从上边开始', () => {
    const placement = place(box(100, 132), 900, { list: box(56, 480), viewport: { width: 1280, height: 500 } });

    expect(placement.maxHeight).toBe(468);
    expect(placement.top).toBe(16);
    expect(placement.arrowTop).toBe(100);
  });
});
