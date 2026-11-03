import type { RegionCover } from '@/shared/map/area/area-coverage';
import { districtsOf } from '@/shared/map/region/region-catalog';
import type { EngineState, SimulationVersion } from '../engine/engine';
import { indicatorResult, valueBreaks } from '../model/analysis';
import type { Calculator, DistrictResult, IndicatorResult } from '../model/calculator';
import { simulationIndicator } from '../model/indicators';
import { isScenario, type SimulationConditions } from '../model/params';
import { scopeCityCodes } from '../model/scope';
import { VALUE_COLORS, valueColor } from '../map/colors';
import { primaryIndicator } from '../run/narrative';

/** 推演完成后主区看推演流程还是推演结果 */
export type RunView = 'flow' | 'result';

/** 结果展示在看什么：哪项指标、哪一年、放大到哪个市（null 是整个推演范围）；地图按数值五档着色 */
export interface ResultSelection {
  readonly indicatorId: string;
  readonly year: number;
  readonly cityCode: string | null;
}

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
  const chosenValid = indicatorId !== undefined && conditions.indicatorIds.includes(indicatorId);
  const cityCodes = scopeCityCodes(conditions.scope);
  return {
    indicatorId: chosenValid ? indicatorId : primaryIndicator(conditions),
    year: year !== undefined && conditions.years.includes(year) ? year : Math.max(...conditions.years),
    cityCode: cityCode && cityCodes.length > 1 && cityCodes.includes(cityCode) ? cityCode : null
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
  readonly scenario: boolean;
}

/** 每项指标在这一年的结果，顺序同条件 */
export function resultItems(version: SimulationVersion, conditions: SimulationConditions, year: number): ResultItem[] {
  return conditions.indicatorIds.map(id => {
    const indicator = simulationIndicator(id);
    return {
      id,
      short: indicator.short,
      name: indicator.name,
      value: indicatorOf(version, year, id).value,
      scenario: isScenario(version.params, id)
    };
  });
}

/** 排行的一行：市的行可以点了放大，区县的行没有 cityCode */
export interface RankRow {
  readonly key: string;
  readonly name: string;
  readonly value: number;
  readonly cityCode: string | null;
  /** 自定义范围部分覆盖的市、区县：只按范围内的部分计算 */
  readonly partial: boolean;
  /** 部分覆盖的区县在范围内的面积占比；市和其余的区县为 null */
  readonly share: number | null;
  /** 自定义范围里市的区县覆盖情况；区县的行和行政区划时为 null */
  readonly cover: RankCover | null;
}

/** 一个市的区县有几个，全部覆盖、部分覆盖的各几个 */
export interface RankCover {
  readonly total: number;
  readonly full: number;
  readonly partial: number;
}

export interface Rank {
  readonly level: 'city' | 'district';
  /** 从高到低 */
  readonly rows: readonly RankRow[];
  /** 条长的满格：最大值再留一点 */
  readonly max: number;
}

// 一个市的区县有几个、全部覆盖和部分覆盖的各几个
function cityCover(cityCode: string, covers: readonly RegionCover[]): RankCover {
  const districts = new Set(districtsOf(cityCode).map(district => district.code));
  const mine = covers.filter(cover => districts.has(cover.code));
  const full = mine.filter(cover => cover.relation === 'full').length;
  return { total: districts.size, full, partial: mine.length - full };
}

/**
 * 选中指标的各市结果；只有一个市时是它的各区县。自定义范围放大到一个市时列这个市的区县，
 * 跨市的范围不把所有区县平铺出来（ADR 0121）
 */
export function rankOf(
  version: SimulationVersion,
  conditions: SimulationConditions,
  indicatorId: string,
  year: number,
  cityCode: string | null = null
): Rank {
  const result = indicatorOf(version, year, indicatorId);
  const { scope } = conditions;
  const area = scope.kind === 'area';
  const cityCodes = scopeCityCodes(scope);
  const only = cityCodes.length === 1 ? cityCodes[0] : area ? cityCode : null;
  // 自定义范围里全部覆盖的区县；市的区县都在里面才算全部覆盖
  const covers = scope.kind === 'area' ? (scope.area?.coverage.covers ?? []) : [];
  const whole = new Set(covers.filter(cover => cover.relation === 'full').map(cover => cover.code));
  const rows: RankRow[] = only
    ? result.rows
        .filter(row => row.cityCode === only)
        .map(row => ({
          key: row.code,
          name: row.name,
          value: row.value,
          cityCode: null,
          partial: area && row.share < 1,
          share: area && row.share < 1 ? row.share : null,
          cover: null
        }))
    : result.cities.map(city => ({
        key: city.code,
        name: city.name.replace(/市$/, ''),
        value: city.value,
        cityCode: city.code,
        partial: area && districtsOf(city.code).some(district => !whole.has(district.code)),
        share: null,
        cover: area ? cityCover(city.code, covers) : null
      }));
  const level = only ? 'district' : 'city';
  return {
    level,
    rows: rows.toSorted((a, b) => b.value - a.value),
    max: Math.max(...rows.map(row => row.value)) * 1.05
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

/** 结果地图的着色和图例：数值五档按标准口径的分位数（年度之间可比） */
export function mapColoring(
  calculator: Calculator,
  conditions: SimulationConditions,
  selection: ResultSelection
): MapColoring {
  const { indicatorId, year } = selection;
  const indicator = simulationIndicator(indicatorId);
  const breaks = valueBreaks(calculator, conditions, indicatorId);
  const ranges = [
    `< ${breaks[0]}`,
    `${breaks[0]} – ${breaks[1]}`,
    `${breaks[1]} – ${breaks[2]}`,
    `${breaks[2]} – ${breaks[3]}`,
    `≥ ${breaks[3]}`
  ];
  return {
    fill: row => valueColor(row.value, breaks),
    legend: {
      title: indicator.short,
      subtitle: `${year} 年 · 单位 ${indicator.unit}`,
      entries: VALUE_COLORS.map((color, index): LegendEntry => ({ color, text: ranges[index] ?? '' })).toReversed()
    }
  };
}
