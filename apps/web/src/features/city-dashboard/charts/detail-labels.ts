import { isValue } from '../calculations';
import type { ChartType, Comparison } from '../model';

export interface LabelPlacement {
  show: boolean;
  position: 'top' | 'inside';
  offset: [number, number];
  compact?: boolean;
}

interface LabelInput {
  comparison: readonly Comparison[];
  cityIndex: number;
  cityCount: number;
  activeYear: number | null;
  chartType: ChartType;
  stacked: boolean;
  axis: { min: number; max: number };
  size: { width: number; height: number };
  formatValue: (value: number | null) => string;
}

// 有数值的一年：标签只给它们
interface LabeledYear {
  readonly year: number;
  readonly value: number;
}

/** 保留旧详情避让算法；密集场景强调当前可见年，完整数值留在表格 */
export function createDetailLabelPlan(input: LabelInput): Record<number, LabelPlacement> {
  const { comparison, cityIndex, cityCount, activeYear, chartType, stacked, axis, size, formatValue } = input;
  const entries = comparison.flatMap((item): LabeledYear[] => {
    const value = item.values[cityIndex];
    return isValue(value) ? [{ year: item.year, value }] : [];
  });
  const primary = entries.find(item => item.year === activeYear) ?? entries.at(-1);
  if (!primary) {
    return {};
  }
  // 放不下逐年标注时只标当前年
  const compact = (): Record<number, LabelPlacement> => ({
    [primary.year]: { show: true, position: stacked ? 'inside' : 'top', offset: [0, 0], compact: true }
  });
  if (stacked || entries.length > 3 || size.width < 360 || size.height < 220) {
    return compact();
  }
  const plotWidth = Math.max(1, size.width - 140);
  const plotHeight = Math.max(1, size.height - 150);
  const labelHeight = 22;
  const separation = labelHeight + 8;
  if (chartType === 'bar') {
    const groupWidth = plotWidth / Math.max(1, cityCount) * 0.8;
    const barWidth = Math.min(32, groupWidth / (entries.length + (entries.length - 1) * 0.65));
    const widest = Math.max(...entries.map(item => formatValue(item.value).length * 10 + 12));
    if (entries.length > 1 && widest + 8 > barWidth * 1.65) {
      return compact();
    }
    return Object.fromEntries(entries.map(item => [item.year, { show: true, position: 'top', offset: [0, 0] }]));
  }
  const placed: number[] = [];
  const plan: Record<number, LabelPlacement> = {};
  for (const item of [primary, ...entries.filter(entry => entry !== primary)]) {
    const pointY = (axis.max - item.value) / (axis.max - axis.min || 1) * plotHeight;
    const preferred = pointY - 10 - labelHeight / 2;
    const candidate = [0, -separation, separation, -2 * separation, 2 * separation]
      .map(offset => Math.max(-24, Math.min(plotHeight - labelHeight / 2, preferred + offset)))
      .find(y => placed.every(other => Math.abs(y - other) >= separation));
    if (candidate === undefined) {
      return compact();
    }
    placed.push(candidate);
    plan[item.year] = { show: true, position: 'top', offset: [0, candidate - preferred] };
  }
  return plan;
}
