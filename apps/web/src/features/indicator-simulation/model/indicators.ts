import { type CategoryId, INDICATOR_CATEGORIES, type IndicatorCategory, INDICATORS, requireIndicator } from '@/shared/city-indicators/catalog';
import { mockIndicatorValue } from '@/shared/city-indicators/mock-value';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { cached } from './cache';

/** 覆盖率的服务半径：步行若干分钟（随步行速度变化），或者固定距离 */
export type Reach = { readonly kind: 'walk'; readonly minutes: number } | { readonly kind: 'radius'; readonly meters: number };

/** 推演模型：覆盖率按服务圈推演，人均值按设施面积与人口推演 */
export type ModelSpec =
  | { readonly model: 'coverage'; readonly facility: string; readonly reach: Reach }
  | { readonly model: 'perCapita'; readonly facility: string };

/** 推演支持的一项指标：目录里的名称、单位、精度，加上模型和简称 */
export type SimulationIndicator = {
  readonly id: string;
  readonly name: string;
  readonly short: string;
  readonly unit: string;
  readonly precision: number;
  readonly categoryId: CategoryId;
} & ModelSpec;

const walk = (minutes: number): Reach => ({ kind: 'walk', minutes });
const radius = (meters: number): Reach => ({ kind: 'radius', meters });
const coverage = (facility: string, short: string, reach: Reach) => ({ model: 'coverage', facility, short, reach }) as const;
const perCapita = (facility: string, short: string) => ({ model: 'perCapita', facility, short }) as const;

// 两类模型能覆盖的 22 项（ADR 0102 第 3 条）；其余指标暂不开放
const SPECS: Readonly<Record<string, ModelSpec & { readonly short: string }>> = {
  'A-15': coverage('消防站', '消防救援覆盖率', radius(2500)),
  'A-14': perCapita('应急避难场所', '人均避难场所'),
  'D01-5': coverage('派出所', '派出所覆盖率', radius(2500)),
  'A08-2': coverage('公交车站', '公交站覆盖率', walk(5)),
  'A08-1': coverage('公共停车场', '停车场覆盖率', walk(10)),
  'B08-2': perCapita('停车用地', '人均停车用地'),
  'F03-2': coverage('火车站', '火车站覆盖率', radius(5000)),
  'F03-4': coverage('长途汽车站', '长途站覆盖率', radius(5000)),
  'A-31': coverage('社区卫生服务设施', '社区卫生覆盖率', walk(15)),
  'A-32': coverage('社区小学', '小学覆盖率', walk(10)),
  'A-33': coverage('社区中学', '中学覆盖率', walk(15)),
  'A-34': coverage('社区养老设施', '养老设施覆盖率', walk(5)),
  'A-35': coverage('文化活动设施', '文化设施覆盖率', walk(15)),
  'A-36': coverage('社区体育设施', '体育设施覆盖率', walk(15)),
  'B-14': coverage('二级以上医院', '医院覆盖率', radius(2000)),
  'B-65': coverage('公园绿地', '公园绿地覆盖率', walk(5)),
  'B-61': perCapita('体育用地', '人均体育用地'),
  'A02-1': coverage('社区幼儿园', '幼儿园覆盖率', walk(5)),
  'B02-6': perCapita('教育用地', '人均教育用地'),
  'B03-3': perCapita('医疗卫生用地', '人均医疗用地'),
  'A-39': perCapita('公园绿地', '人均公园绿地'),
  'B07-2': perCapita('广场用地', '人均广场用地')
};

const isCategory = (id: string): id is CategoryId => INDICATOR_CATEGORIES.some(category => category.id === id);

/** 推演支持的指标，按共用目录的顺序；名称、单位、精度取自目录 */
export const SIMULATION_INDICATORS: readonly SimulationIndicator[] = INDICATORS.flatMap(({ id, name, unit, precision, categoryId }) => {
  const spec = SPECS[id];
  if (!spec) {
    return [];
  }
  if (!isCategory(categoryId)) {
    throw new Error(`指标 ${id} 的分类 ${categoryId} 不在目录里`);
  }
  return [{ id, name, unit, precision, categoryId, ...spec }];
});

/** 清单里写了、目录里却没有的编码（应为空，测试检查） */
export const UNKNOWN_SPEC_IDS: readonly string[] = Object.keys(SPECS).filter(id => !SIMULATION_INDICATORS.some(item => item.id === id));

const BY_ID = new Map(SIMULATION_INDICATORS.map(indicator => [indicator.id, indicator]));

/** 按编码取推演支持的指标；不支持的抛错（编码来自本模块的清单，出错是程序问题） */
export function simulationIndicator(id: string): SimulationIndicator {
  const indicator = BY_ID.get(id);
  if (!indicator) {
    throw new Error(`推演不支持指标 ${id}`);
  }
  return indicator;
}

/** 条件库的分组：四类指标各自支持的几项，没有支持项的分类不出现 */
export const INDICATOR_GROUPS: readonly (IndicatorCategory & { readonly indicators: readonly SimulationIndicator[] })[] =
  INDICATOR_CATEGORIES.map(({ id, name }) => ({
    id,
    name,
    indicators: SIMULATION_INDICATORS.filter(indicator => indicator.categoryId === id)
  })).filter(group => group.indicators.length > 0);

/** 步行类覆盖率：服务半径随步行速度变化 */
export const isWalkCoverage = (indicator: SimulationIndicator): boolean => indicator.model === 'coverage' && indicator.reach.kind === 'walk';

/** 所选指标里步行类覆盖率的分钟数，去重、从小到大 */
export function walkMinutes(indicatorIds: readonly string[]): number[] {
  const minutes = indicatorIds.flatMap(id => {
    const indicator = simulationIndicator(id);
    return indicator.model === 'coverage' && indicator.reach.kind === 'walk' ? [indicator.reach.minutes] : [];
  });
  return [...new Set(minutes)].toSorted((a, b) => a - b);
}

/** 服务半径（米）；人均类没有服务半径 */
export function reachMeters(indicator: SimulationIndicator, walkSpeed: number): number | null {
  if (indicator.model !== 'coverage') {
    return null;
  }
  return indicator.reach.kind === 'walk' ? indicator.reach.minutes * walkSpeed : indicator.reach.meters;
}

/** 服务半径的说明：如"步行 5 分钟""2.5 公里半径" */
export function reachText(indicator: SimulationIndicator): string {
  if (indicator.model !== 'coverage') {
    return '面积 ÷ 人口';
  }
  const { reach } = indicator;
  if (reach.kind === 'walk') {
    return `步行 ${reach.minutes} 分钟`;
  }
  return reach.meters >= 1000 ? `${reach.meters / 1000} 公里半径` : `${reach.meters} 米半径`;
}

/**
 * 演示目标值：2026 年 13 市模拟值的中位数取整（覆盖率到 5，人均值 10 以上到 1、以下到 0.1），大约一半城市达标；
 * 不代表规范标准。第一次用到时才算（地图页分块不在顶层计算，ADR 0061）
 */
export const demoTarget = cached((id: string): number => {
  const indicator = requireIndicator(id);
  const values = JIANGSU_CITIES.map(city => mockIndicatorValue(city.code, indicator, 2026)).toSorted((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)] ?? 0;
  const step = indicator.unit === '%' ? 5 : median >= 10 ? 1 : 0.1;
  return Number((Math.round(median / step) * step).toFixed(1));
}, id => id);
