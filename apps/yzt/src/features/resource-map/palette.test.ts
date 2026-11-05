// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { COLOR_PRESETS } from './palette';

// #RRGGBB 的三个通道
const channels = (value: string) => [1, 3, 5].map(start => Number.parseInt(value.slice(start, start + 2), 16));

// 两种颜色按比例混合（weight 是 other 的占比），各通道四舍五入
function mix(hex: string, other: string, weight: number): string {
  const [from, to] = [channels(hex), channels(other)];
  const mixed = from.map((value, index) => Math.round(value * (1 - weight) + (to[index] ?? 0) * weight));
  return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

// HSL 的色相（度）
function hue(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex).map(value => value / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const sector = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return sector * 60;
}

describe('取色器的预设色', () => {
  const top = COLOR_PRESETS.slice(0, 10);
  const bottom = COLOR_PRESETS.slice(10);

  it('两行各 10 个，正好排满 Element 的预设区；上行是旧项目的快捷色，最后是黑', () => {
    expect(COLOR_PRESETS).toHaveLength(20);
    expect(top).toStrictEqual([
      '#D9433F',
      '#E07B39',
      '#C79212',
      '#77A82E',
      '#2FA663',
      '#16B3B3',
      '#2278BE',
      '#7A4FC0',
      '#B03A6B',
      '#000000'
    ]);
  });

  it('下行是同一列和白色 1 : 1 混合的浅色，最后是白', () => {
    expect(bottom).toStrictEqual([...top.slice(0, 9).map(color => mix(color, '#FFFFFF', 0.5)), '#FFFFFF']);
  });

  it('前 9 列按色相从红到玫红排列，上下两行同一列的色相相同', () => {
    const hues = top.slice(0, 9).map(hue);

    expect(hues.every((value, index) => index === 0 || value > (hues[index - 1] ?? Infinity))).toBe(true);
    for (const [index, value] of hues.entries()) {
      expect(hue(bottom[index] ?? '')).toBeCloseTo(value, -1);
    }
  });
});
