// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ViewportBox } from '../layer-panel/popover-placement';
import { type RequestPopoverInput, requestPopoverPlacement } from './request-popover';

const box = (left: number, top: number, right: number, bottom: number): ViewportBox => ({ left, top, right, bottom });

// 1280×800 的窗口，顶栏 56，地图四周留白 16：地图区域是 (16, 72)～(1264, 784)，状态栏的上边在 760
const WIDE: RequestPopoverInput = {
  panel: box(16, 72, 336, 748),
  area: box(16, 72, 1264, 784),
  barTop: 760,
  viewport: { height: 800 }
};

describe('requestPopoverPlacement', () => {
  it('贴着面板的右边，底边在状态栏上方 8，最高 420', () => {
    expect(requestPopoverPlacement(WIDE)).toStrictEqual({ left: 344, bottom: 48, width: 340, maxHeight: 420 });
  });

  it('面板变窄、收起成竖条时跟着面板的右边走，底边不变', () => {
    const narrow = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 256, 748) });
    expect([narrow.left, narrow.bottom]).toStrictEqual([264, 48]);
    const strip = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 40, 748) });
    expect([strip.left, strip.bottom]).toStrictEqual([48, 48]);
  });

  it('右边放不下时向左移、盖住面板；区域比浮层窄时和区域同宽', () => {
    // 手机宽度展开着面板：面板几乎占满区域
    const phone = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 303, 748), area: box(16, 72, 359, 784) });
    expect(phone).toMatchObject({ left: 19, width: 340 });
    const tiny = requestPopoverPlacement({ ...WIDE, panel: box(16, 72, 300, 748), area: box(16, 72, 316, 784) });
    expect(tiny).toMatchObject({ left: 16, width: 300 });
  });

  it('区域上边放不下 420 时变矮，再矮也不是负数', () => {
    const low = requestPopoverPlacement({ ...WIDE, area: box(16, 72, 1264, 440), barTop: 416, viewport: { height: 456 } });
    expect(low).toMatchObject({ bottom: 48, maxHeight: 336 });
    const flat = requestPopoverPlacement({ ...WIDE, area: box(16, 72, 1264, 80), barTop: 76, viewport: { height: 96 } });
    expect(flat.maxHeight).toBe(0);
  });

  it('量不到面板时贴着区域的左边', () => {
    expect(requestPopoverPlacement({ ...WIDE, panel: null }).left).toBe(16);
  });
});
