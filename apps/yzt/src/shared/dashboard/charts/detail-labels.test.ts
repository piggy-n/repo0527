// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDetailLabelPlan } from './detail-labels';

const input = {
  comparison: [2024, 2025, 2026].map(year => ({ year, values: [50], average: 50 })),
  cityIndex: 0,
  cityCount: 13,
  activeYear: 2026,
  chartType: 'line' as const,
  stacked: false,
  axis: { min: 0, max: 100 },
  size: { width: 1000, height: 500 },
  formatValue: (value: number | null) => String(value)
};

describe('详情数值避让', () => {
  it('接近的折线值分开显示，当前年份优先占位', () => {
    const plan = createDetailLabelPlan(input);
    expect(plan[2026].offset).toEqual([0, 0]);
    expect(new Set(Object.values(plan).map(item => item.offset[1])).size).toBe(3);
  });
  it('隐藏当前年份后密集柱图突出最后一个可见年份', () => {
    const plan = createDetailLabelPlan({ ...input, chartType: 'bar', comparison: input.comparison.slice(0, 2) });
    expect(Object.keys(plan)).toEqual(['2025']);
    expect(plan[2025].show).toBe(true);
  });
  it('无有效值不生成标签，窄屏只保留当前年', () => {
    expect(createDetailLabelPlan({
      ...input,
      comparison: [{ year: 2026, values: [null], average: null }]
    })).toEqual({});
    expect(Object.keys(createDetailLabelPlan({ ...input, size: { width: 300, height: 180 } }))).toEqual(['2026']);
  });
});
