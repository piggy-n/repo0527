// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { arrangePrint, CORNER_LIMITS, scaledPixels } from './print-image';
import { printFileName } from './print-file-name';
import type { LegendLayout } from './print-legend';

const MAP = { width: 1440, height: 800 };

// 按最高高度给出固定尺寸的图例
function fixed(width: number, height: number) {
  return vi.fn<(maxHeight: number) => LegendLayout>(() => ({ items: [], columns: 1, width, height }));
}

describe('arrangePrint', () => {
  it('右侧一栏：图片变宽，图例和地图一样高地分列', () => {
    const layoutOf = fixed(232, 400);

    const arrangement = arrangePrint(MAP, 'side', true, layoutOf);

    expect(arrangement).toMatchObject({ placement: 'side', width: 1672, height: 800, legend: { x: 1440, y: 0 } });
    expect(layoutOf).toHaveBeenCalledWith(800);
  });

  it('右下角：叠在地图上，离右边、下边 16；最高按地图高度的 60% 分列', () => {
    const layoutOf = fixed(232, 300);

    const arrangement = arrangePrint(MAP, 'corner', true, layoutOf);

    expect(arrangement).toMatchObject({
      placement: 'corner',
      width: 1440,
      height: 800,
      legend: { x: 1440 - 232 - 16, y: 800 - 300 - 16 }
    });
    expect(layoutOf).toHaveBeenCalledWith(800 * CORNER_LIMITS.height);
  });

  it('右下角放不下（太宽或者一项就比 60% 高）时改放在右侧', () => {
    expect(arrangePrint(MAP, 'corner', true, fixed(700, 300)).placement).toBe('side');
    expect(arrangePrint(MAP, 'corner', true, fixed(232, 600)).placement).toBe('side');
  });

  it('右侧一栏比地图高时图片跟着变高', () => {
    expect(arrangePrint(MAP, 'side', true, fixed(232, 900))).toMatchObject({ width: 1672, height: 900 });
  });

  it('不带图例、没有图例条目时只有地图', () => {
    const layoutOf = fixed(232, 300);

    expect(arrangePrint(MAP, 'none', true, layoutOf)).toStrictEqual({ placement: 'none', ...MAP, legend: null });
    expect(arrangePrint(MAP, 'side', false, layoutOf)).toStrictEqual({ placement: 'none', ...MAP, legend: null });
    expect(layoutOf).not.toHaveBeenCalled();
  });
});

describe('scaledPixels', () => {
  it('按给的像素比放大整张图（地图加图例）；地图超过 MapLibre 的画布上限 4096 时像素比跟着收小', () => {
    expect(scaledPixels({ width: 1672, height: 800, map: MAP }, 2)).toStrictEqual([3344, 1600]);
    // 4096 ÷ 2560 = 1.6
    expect(scaledPixels({ width: 2792, height: 1200, map: { width: 2560, height: 1200 } }, 2)).toStrictEqual([
      4467, 1920
    ]);
    // 竖着的地图按高度收：4096 ÷ 2200
    expect(scaledPixels({ width: 1000, height: 2200, map: { width: 1000, height: 2200 } }, 2)).toStrictEqual([
      1862, 4096
    ]);
  });
});

describe('printFileName', () => {
  it('名称-年月日-时分秒.png，按本地时间补零', () => {
    expect(printFileName('现状底图', new Date(2026, 10, 24, 1, 45, 30))).toBe('现状底图-20261124-014530.png');
    expect(printFileName('现状底图', new Date(2027, 0, 3, 9, 5, 7))).toBe('现状底图-20270103-090507.png');
  });
});
