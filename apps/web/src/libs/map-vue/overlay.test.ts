// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type Box, computeOverlayPadding, type MeasuredOverlay, resolveOverlayOptions } from './overlay';

const DEFAULTS = resolveOverlayOptions();

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height };
}

// 1440 × 620 的画布，与 5A.3 的设计稿同样的尺寸
const CANVAS = box(0, 0, 1440, 620);
const LEFT_PANEL: MeasuredOverlay = { edge: 'left', box: box(16, 16, 320, 588) };
const TOOLBAR: MeasuredOverlay = { edge: 'top', box: box(664, 16, 760, 40) };
const RIGHT_COLUMN: MeasuredOverlay = { edge: 'right', box: box(1104, 72, 320, 532) };

describe('computeOverlayPadding', () => {
  it('没有悬浮元素时四边都是边距', () => {
    expect(computeOverlayPadding(CANVAS, [], DEFAULTS)).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
  });

  it('每一边是占用加间隔：左侧面板 16 + 320 + 16，工具栏 16 + 40 + 16，右侧一列 16 + 320 + 16', () => {
    expect(computeOverlayPadding(CANVAS, [LEFT_PANEL, TOOLBAR, RIGHT_COLUMN], DEFAULTS)).toEqual({
      top: 72,
      right: 352,
      bottom: 16,
      left: 352
    });
  });

  it('同一边有多个元素时取占用最大的', () => {
    const strip: MeasuredOverlay = { edge: 'left', box: box(16, 16, 40, 588) };
    // 大的在前：后登记的覆盖前面的写法会得到 72
    expect(computeOverlayPadding(CANVAS, [LEFT_PANEL, strip], DEFAULTS).left).toBe(352);
  });

  it('尺寸为 0、和画布不相交的元素不算；超出画布的部分不算', () => {
    const hidden: MeasuredOverlay = { edge: 'left', box: box(16, 16, 0, 0) };
    const outside: MeasuredOverlay = { edge: 'right', box: box(1500, 16, 320, 500) };
    const overflowing: MeasuredOverlay = { edge: 'bottom', box: box(400, 560, 300, 200) };
    // 登记为左、但整个在画布下方：不检查相交就会算出 352
    const below: MeasuredOverlay = { edge: 'left', box: box(16, 700, 320, 200) };

    expect(computeOverlayPadding(CANVAS, [hidden, outside, overflowing, below], DEFAULTS)).toEqual({
      top: 16,
      right: 16,
      bottom: 76,
      left: 16
    });
  });

  it('按画布的位置换算：画布不在页面左上角时结果相同', () => {
    const offset = (overlay: MeasuredOverlay): MeasuredOverlay => ({
      edge: overlay.edge,
      box: box(overlay.box.left + 200, overlay.box.top + 100, 320, overlay.box.bottom - overlay.box.top)
    });
    const canvas = box(200, 100, 1440, 620);

    expect(computeOverlayPadding(canvas, [offset(LEFT_PANEL)], DEFAULTS)).toEqual(
      computeOverlayPadding(CANVAS, [LEFT_PANEL], DEFAULTS)
    );
  });

  it('两侧之和超过画布的 2/3 时按比例缩小，可视区域至少保留 1/3', () => {
    // 5A.2c 的情况：420 宽的画布，左侧窄条、右侧一列
    const canvas = box(0, 0, 420, 620);
    const strip: MeasuredOverlay = { edge: 'left', box: box(16, 16, 40, 588) };
    const right: MeasuredOverlay = { edge: 'right', box: box(84, 72, 320, 532) };

    const padding = computeOverlayPadding(canvas, [strip, right], DEFAULTS);

    expect(padding.left + padding.right).toBeLessThanOrEqual(280);
    expect(padding).toEqual({ top: 16, right: 232, bottom: 16, left: 47 });
  });

  it('纵向同样有下限', () => {
    const canvas = box(0, 0, 1440, 300);
    const top: MeasuredOverlay = { edge: 'top', box: box(0, 0, 1440, 200) };

    const padding = computeOverlayPadding(canvas, [top], DEFAULTS);

    expect(padding.top + padding.bottom).toBeLessThanOrEqual(200);
    expect(300 - padding.top - padding.bottom).toBeGreaterThanOrEqual(100);
  });

  it('边距、间隔、下限可以修改', () => {
    const options = resolveOverlayOptions({ edgePadding: 40, gap: 8, minVisibleRatio: 0.5 });

    expect(computeOverlayPadding(CANVAS, [LEFT_PANEL], options)).toEqual({ top: 40, right: 40, bottom: 40, left: 344 });
  });
});

describe('resolveOverlayOptions', () => {
  it('补上默认值', () => {
    expect(resolveOverlayOptions({ gap: 8 })).toEqual({ edgePadding: 16, gap: 8, minVisibleRatio: 1 / 3 });
  });

  it('取值不合法时抛错', () => {
    expect(() => resolveOverlayOptions({ gap: -1 })).toThrow('edgePadding、gap 不能为负数');
    expect(() => resolveOverlayOptions({ minVisibleRatio: 0 })).toThrow('minVisibleRatio 要在 (0, 1] 之间');
    expect(() => resolveOverlayOptions({ minVisibleRatio: Number.NaN })).toThrow('minVisibleRatio 要在 (0, 1] 之间');
  });
});
