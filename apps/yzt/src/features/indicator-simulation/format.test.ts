// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatEstimate, formatEstimateDelta, roundEstimate } from './format';

const percent = { unit: '%' };
const perCapita = { unit: '平方米/人' };

describe('预估的格式', () => {
  it('百分比取整、人均值保留一位，前面加"≈"', () => {
    expect(formatEstimate(84.6, percent)).toBe('≈85%');
    expect(formatEstimate(1.349, perCapita)).toBe('≈1.3 平方米/人');
  });

  it('按显示的精度取整，没有 -0', () => {
    expect(roundEstimate(66.5, percent)).toBe(67);
    expect(roundEstimate(1.25, perCapita)).toBe(1.3);
    expect(Object.is(roundEstimate(-0.3, percent), 0)).toBe(true);
  });

  it('变化量带正负号，没有变化时写 0；百分比写成"个百分点"', () => {
    expect(formatEstimateDelta(2, percent)).toBe('+2 个百分点');
    expect(formatEstimateDelta(-4, percent)).toBe('−4 个百分点');
    expect(formatEstimateDelta(0.1 - 0.3, perCapita)).toBe('−0.2 平方米/人');
    expect(formatEstimateDelta(-0.4, percent)).toBe('0 个百分点');
  });
});
