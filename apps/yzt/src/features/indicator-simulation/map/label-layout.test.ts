// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { labelLevels, labelWidth } from './label-layout';

const spec = (x: number, y: number, first = false) => ({ point: { x, y }, name: '南京', value: '47.7%', first });

describe('labelWidth', () => {
  it('完整的比只有名称的宽，只有名称的比圆点宽；汉字按 12、其余按 7 估', () => {
    // 内边距 16 + 圆点和间隔 11 + 两个汉字 24 + 间隔 4 + 五个字符 35
    expect(labelWidth(spec(0, 0), 'full')).toBe(90);
    expect(labelWidth(spec(0, 0), 'name')).toBe(51);
    expect(labelWidth(spec(0, 0), 'dot')).toBe(17);
  });
});

describe('labelLevels', () => {
  it('不重叠时都写完整；压住时后摆的先省掉数值，再只留圆点', () => {
    expect(labelLevels([spec(0, 0), spec(200, 0)])).toEqual(['full', 'full']);
    // 中心相距 75：完整的（90 宽）压住，只有名称（51 宽）放得下
    expect(labelLevels([spec(0, 0), spec(75, 0)])).toEqual(['full', 'name']);
    // 上下只差 10：名称也压住，只留圆点
    expect(labelLevels([spec(0, 0), spec(0, 10)])).toEqual(['full', 'dot']);
  });

  it('先摆悬停、放大的市：它写完整，别的让开', () => {
    expect(labelLevels([spec(0, 0), spec(75, 0, true)])).toEqual(['name', 'full']);
  });
});
