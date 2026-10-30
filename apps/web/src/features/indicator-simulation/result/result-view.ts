import type { EngineState, SimulationVersion } from '../engine/engine';
import { indicatorResult, type PassState, passState, valueBreaks } from '../model/analysis';
import type { Calculator, DistrictResult, IndicatorResult } from '../model/calculator';
import { simulationIndicator } from '../model/indicators';
import { isScenario, type SimulationConditions } from '../model/params';
import { PASS_COLORS, VALUE_COLORS, valueColor } from '../map/colors';
import { primaryIndicator } from '../run/narrative';

/** 推演完成后主区看推演流程还是推演结果 */
export type RunView = 'flow' | 'result';

/** 结果地图的着色：数值五档、达标三态 */
export type MapMode = 'value' | 'pass';

/** 结果展示在看什么：哪项指标、哪一年、地图怎么着色、放大到哪个市（null 是整个推演范围） */
export interface ResultSelection {
  readonly indicatorId: string;
  readonly year: number;
  readonly mode: MapMode;
  readonly cityCode: string | null;
}

/** 达标三态的说法 */
export const PASS_TEXT: Readonly<Record<PassState, string>> = { pass: '达标', near: '接近达标', fail: '未达标' };

/**
 * 按最新一版的条件定下在看什么：选过的指标、年度、市还在条件里就沿用，否则是主指标、最新年度、整个范围；
 * 还没有结果时为 null。只有一个市时不放大（范围就是这个市）
 */
export function resolveSelection(state: EngineState, chosen: Partial<ResultSelection>): ResultSelection | null {
  const { conditions } = state;
  if (state.versions.length === 0 || !conditions) {
    return null;
  }
  const { indicatorId, year, cityCode } = chosen;
  return {
    indicatorId: indicatorId !== undefined && conditions.indicatorIds.includes(indicatorId) ? indicatorId : primaryIndicator(conditions),
    year: year !== undefined && conditions.years.includes(year) ? year : Math.max(...conditions.years),
    mode: chosen.mode ?? 'value',
    cityCode: cityCode && conditions.cityCodes.length > 1 && conditions.cityCodes.includes(cityCode) ? cityCode : null
  };
}

const indicatorOf = (version: SimulationVersion, year: number, id: string): IndicatorResult =>
  indicatorResult(version.result[year]?.indicators ?? {}, id);

/** 左侧一项指标的结果 */
export interface ResultItem {
  readonly id: string;
  readonly short: string;
  readonly name: string;
  readonly value: number;
  readonly target: number;
  /** 一个市时是这个市的达标；多个市时全部达标、都没达标、部分达标 */
  readonly state: PassState;
  readonly verdict: string;
  readonly scenario: boolean;
}

/** 每项指标在这一年的结果，顺序同条件 */
export function resultItems(version: SimulationVersion, conditions: SimulationConditions, year: number): ResultItem[] {
  return conditions.indicatorIds.map(id => {
    const indicator = simulationIndicator(id);
    const result = indicatorOf(version, year, id);
    const single = result.total === 1;
    const state = single
      ? passState(result.value, result.target)
      : result.passCount === result.total
        ? 'pass'
        : result.passCount === 0
          ? 'fail'
          : 'near';
    return {
      id,
      short: indicator.short,
      name: indicator.name,
      value: result.value,
      target: result.target,
      state,
      verdict: single ? PASS_TEXT[state] : `达标 ${result.passCount}/${result.total} 市`,
      scenario: isScenario(version.params, id)
    };
  });
}

/** 排行的一行：市的行可以点了放大，区县的行没有 cityCode */
export interface RankRow {
  readonly key: string;
  readonly name: string;
  readonly value: number;
  readonly state: PassState;
  readonly cityCode: string | null;
}

export interface Rank {
  readonly level: 'city' | 'district';
  /** 从高到低 */
  readonly rows: readonly RankRow[];
  readonly target: number;
  /** 条长的满格：目标和最大值中大的一个再留一点 */
  readonly max: number;
}

/** 选中指标的各市结果；只有一个市时是它的各区县 */
export function rankOf(version: SimulationVersion, conditions: SimulationConditions, indicatorId: string, year: number): Rank {
  const result = indicatorOf(version, year, indicatorId);
  const level = conditions.cityCodes.length === 1 ? 'district' : 'city';
  const rows: RankRow[] =
    level === 'district'
      ? result.rows.map(row => ({ key: row.code, name: row.name, value: row.value, state: passState(row.value, result.target), cityCode: null }))
      : result.cities.map(city => ({
          key: city.code,
          name: city.name.replace(/市$/, ''),
          value: city.value,
          state: passState(city.value, result.target),
          cityCode: city.code
        }));
  return {
    level,
    rows: rows.toSorted((a, b) => b.value - a.value),
    target: result.target,
    max: Math.max(result.target, ...rows.map(row => row.value)) * 1.05
  };
}

/** 图例的一行 */
export interface LegendEntry {
  readonly color: string;
  readonly text: string;
}

export interface MapColoring {
  readonly fill: (row: DistrictResult) => string;
  readonly legend: { readonly title: string; readonly subtitle: string; readonly entries: readonly LegendEntry[] };
}

// 数值后的单位：百分号紧跟，其他单位前空一格
const unitText = (unit: string) => (unit === '%' ? '%' : ` ${unit}`);

/** 结果地图的着色和图例：数值五档按标准口径的分位数（年度之间可比），达标按目标值 */
export function mapColoring(
  calculator: Calculator,
  conditions: SimulationConditions,
  selection: ResultSelection,
  version: SimulationVersion
): MapColoring {
  const { indicatorId, year, mode } = selection;
  const indicator = simulationIndicator(indicatorId);

  if (mode === 'pass') {
    const { target } = indicatorOf(version, year, indicatorId);
    return {
      fill: row => PASS_COLORS[passState(row.value, target)],
      legend: {
        title: indicator.short,
        subtitle: `${year} 年 · 目标 ≥ ${target}${unitText(indicator.unit)}`,
        entries: [
          { color: PASS_COLORS.pass, text: '达标' },
          { color: PASS_COLORS.near, text: '接近（差 5% 以内）' },
          { color: PASS_COLORS.fail, text: '未达标' }
        ]
      }
    };
  }
  const breaks = valueBreaks(calculator, conditions, indicatorId);
  const ranges = [`< ${breaks[0]}`, `${breaks[0]} – ${breaks[1]}`, `${breaks[1]} – ${breaks[2]}`, `${breaks[2]} – ${breaks[3]}`, `≥ ${breaks[3]}`];
  return {
    fill: row => valueColor(row.value, breaks),
    legend: {
      title: indicator.short,
      subtitle: `${year} 年 · 单位 ${indicator.unit}`,
      entries: VALUE_COLORS.map((color, index): LegendEntry => ({ color, text: ranges[index] ?? '' })).toReversed()
    }
  };
}
