import { type Indicator, requireIndicator } from './catalog';
import { mockIndicatorValue } from './mock-value';
import reportValues from './report-values.json';

/** 值的来源：简报的原数、从简报折算、简报没有时的原 mock */
export type IndicatorValueSource = 'report' | 'scaled' | 'mock';

const REPORT: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>> = reportValues;
const REPORT_FIRST_YEAR = 2025;
const REPORT_LAST_YEAR = 2026;

// 简报两年口径不同的指标：不用 2025 的数，2025 及以前都从 2026 折算（A-15 的 2026 年不再采集微型消防站，ADR 0130）
const LAST_YEAR_ONLY = new Set(['A-15']);

// 简报只有超高层建筑的合计（A-16）：住宅分项按原 mock 的占比取整，其余归非住宅，合计仍等于简报值
const PARTS_TOTAL = 'A-16';
const HOUSING_PART = 'D02-3-1';
const OTHER_PART = 'D02-3-2';

// 这项指标这一年能直接用的简报值
function reportedValues(id: string, year: number) {
  return LAST_YEAR_ONLY.has(id) && year !== REPORT_LAST_YEAR ? undefined : REPORT[year]?.[id];
}

// 简报年份之外：从最近的简报年份出发，按原 mock 的逐年比例折算；原 mock 这一年是 0 时比例无从算起，保持不变
function scaledValue(cityCode: string, indicator: Indicator, year: number, anchor: number, anchorYear: number): number {
  const base = mockIndicatorValue(cityCode, indicator, anchorYear);
  const ratio = base > 0 ? mockIndicatorValue(cityCode, indicator, year) / base : 1;
  const upper = indicator.unit === '%' ? 100 : Infinity;
  return Number(Math.min(upper, anchor * ratio).toFixed(indicator.precision));
}

/**
 * 某市、某年、某指标的值：简报有的用简报（2026、2025，A-15 只用 2026），其余年份按原 mock 的走势折算，简报没有的指标沿用原 mock。
 * 同样的输入永远得到同样的数（docs/modules/city-indicators.md）
 */
export function indicatorValue(cityCode: string, indicator: Indicator, year: number): number {
  const { id } = indicator;
  const reported = reportedValues(id, year)?.[cityCode];
  if (reported !== undefined) {
    return reported;
  }
  const anchorYear = year < REPORT_FIRST_YEAR && !LAST_YEAR_ONLY.has(id) ? REPORT_FIRST_YEAR : REPORT_LAST_YEAR;
  const anchor = REPORT[anchorYear]?.[id]?.[cityCode];
  if (anchor !== undefined) {
    return scaledValue(cityCode, indicator, year, anchor, anchorYear);
  }
  if (id === HOUSING_PART || id === OTHER_PART) {
    const total = requireIndicator(PARTS_TOTAL);
    const sum = indicatorValue(cityCode, total, year);
    const mockSum = mockIndicatorValue(cityCode, total, year);
    const share = mockSum > 0 ? mockIndicatorValue(cityCode, requireIndicator(HOUSING_PART), year) / mockSum : 0;
    const housing = Math.round(sum * share);
    return id === HOUSING_PART ? housing : sum - housing;
  }
  return mockIndicatorValue(cityCode, indicator, year);
}

/** 这个值的来源；超高层的两个分项由简报的合计分配，算折算 */
export function indicatorValueSource(id: string, year: number): IndicatorValueSource {
  if (reportedValues(id, year)) {
    return 'report';
  }
  return REPORT[REPORT_LAST_YEAR]?.[id] || id === HOUSING_PART || id === OTHER_PART ? 'scaled' : 'mock';
}
