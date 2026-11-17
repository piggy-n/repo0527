// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { paletteColor } from './palette';

describe('paletteColor', () => {
  it('最新年份取组里的第一色，往前每年取下一色，6 年一循环', () => {
    const colors = [2025, 2024, 2023, 2022, 2021, 2020].map(year => paletteColor(year, 0, 2025));
    expect(colors).toEqual(['#1849A9', '#3288F5', '#007397', '#855AD2', '#743A71', '#249374']);
    expect(paletteColor(2019, 0, 2025)).toBe('#1849A9');
  });

  it('比最新年份还新的年份倒着回绕，不越界', () => {
    expect(paletteColor(2026, 0, 2025)).toBe('#249374');
    expect(paletteColor(2031, 0, 2025)).toBe('#1849A9');
  });

  it('三组按卡片序号取模', () => {
    expect([0, 1, 2].map(group => paletteColor(2025, group, 2025))).toEqual(['#1849A9', '#006C4A', '#7236B4']);
    expect(paletteColor(2025, 3, 2025)).toBe('#1849A9');
    expect(paletteColor(2024, 4, 2025)).toBe('#0B99A3');
  });
});
