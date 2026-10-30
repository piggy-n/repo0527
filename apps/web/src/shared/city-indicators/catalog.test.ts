// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { INDICATOR_CATEGORIES, INDICATORS, requireIndicator } from './catalog';

describe('城市体检指标目录', () => {
  it('96 项、编码不重复，四类分别是 5、27、44、20 项，都带来源', () => {
    expect(new Set(INDICATORS.map(indicator => indicator.id)).size).toBe(96);
    expect(INDICATOR_CATEGORIES.map(category => INDICATORS.filter(indicator => indicator.categoryId === category.id).length)).toEqual([5, 27, 44, 20]);
    expect(INDICATORS.every(indicator => indicator.sourceFile && indicator.sourceGroup)).toBe(true);
  });

  it('按编码取指标，目录里没有的抛错', () => {
    expect(requireIndicator('B-65').name).toBe('公园绿地、广场步行5分钟覆盖率');
    expect(() => requireIndicator('X-1')).toThrow('指标目录缺少 X-1');
  });
});
