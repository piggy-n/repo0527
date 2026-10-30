import {
  type CategoryId,
  INDICATOR_CATEGORIES,
  type IndicatorCategory,
  INDICATORS
} from '@/shared/city-indicators/catalog';

/** 覆盖率的服务范围：步行若干分钟、车行若干分钟（Excel 写明了距离），或者缓冲区的固定距离 */
export type Reach =
  | { readonly kind: 'walk'; readonly minutes: number }
  | { readonly kind: 'drive'; readonly minutes: number; readonly meters: number }
  | { readonly kind: 'radius'; readonly meters: number };

/** 步行分钟数对应的距离（米）：Excel 的 5、10、15 分钟三档，不是"速度 × 分钟" */
export const WALK_METERS: Readonly<Record<number, number>> = { 5: 300, 10: 500, 15: 1000 };

/** 覆盖的对象：住宅用地（覆盖面积 ≥ 50% 的图斑算覆盖），或城区面积（相交即算） */
export type CoverageBase = 'residential' | 'area';

/** 推演模型：覆盖率按服务范围推演，人均值按用地面积与人口推演 */
export type ModelSpec =
  | {
      readonly model: 'coverage';
      readonly facility: string;
      readonly reach: Reach;
      readonly base: CoverageBase;
      /** Excel 备注里站点的步行时间由 5 分钟改为 15 分钟（新旧规程） */
      readonly ruleChange: boolean;
    }
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
const drive = (minutes: number, meters: number): Reach => ({ kind: 'drive', minutes, meters });
const radius = (meters: number): Reach => ({ kind: 'radius', meters });
const coverage = (
  facility: string,
  short: string,
  reach: Reach,
  { base = 'residential', ruleChange = false }: { readonly base?: CoverageBase; readonly ruleChange?: boolean } = {}
) => ({ model: 'coverage', facility, short, reach, base, ruleChange }) as const;
const perCapita = (facility: string, short: string) => ({ model: 'perCapita', facility, short }) as const;

// 两类模型能覆盖的 22 项（ADR 0105 第 3 条），服务范围和覆盖对象按 Excel 的计算方法（docs/modules/indicator-simulation.md）
const SPECS: Readonly<Record<string, ModelSpec & { readonly short: string }>> = {
  'A-15': coverage('消防站', '消防救援覆盖率', drive(5, 3000), { base: 'area' }),
  'A-14': perCapita('应急避难场所', '人均避难场所'),
  'D01-5': coverage('派出所', '派出所覆盖率', drive(5, 3000), { base: 'area' }),
  'A08-2': coverage('公交车站', '公交站覆盖率', walk(5)),
  'A08-1': coverage('公共停车场', '停车场覆盖率', walk(10)),
  'B08-2': perCapita('停车用地', '人均停车用地'),
  'F03-2': coverage('火车站', '火车站覆盖率', radius(5000)),
  'F03-4': coverage('长途汽车站', '长途站覆盖率', radius(5000)),
  'A-31': coverage('社区卫生服务设施', '社区卫生覆盖率', walk(15), { ruleChange: true }),
  'A-32': coverage('社区小学', '小学覆盖率', walk(10)),
  'A-33': coverage('社区中学', '中学覆盖率', walk(15)),
  'A-34': coverage('社区养老设施', '养老设施覆盖率', walk(5)),
  'A-35': coverage('文化活动设施', '文化设施覆盖率', walk(15), { ruleChange: true }),
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
export const SIMULATION_INDICATORS: readonly SimulationIndicator[] = INDICATORS.flatMap(indicator => {
  const { id, name, unit, precision, categoryId } = indicator;
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
export const UNKNOWN_SPEC_IDS: readonly string[] = Object.keys(SPECS).filter(
  id => !SIMULATION_INDICATORS.some(item => item.id === id)
);

const BY_ID = new Map(SIMULATION_INDICATORS.map(indicator => [indicator.id, indicator]));

/** 按编码取推演支持的指标；不支持的抛错（编码来自本模块的清单，出错是程序问题） */
export function simulationIndicator(id: string): SimulationIndicator {
  const indicator = BY_ID.get(id);
  if (!indicator) {
    throw new Error(`计算不支持指标 ${id}`);
  }
  return indicator;
}

/** 条件库的分组：四类指标各自支持的几项，没有支持项的分类不出现 */
type IndicatorGroup = IndicatorCategory & { readonly indicators: readonly SimulationIndicator[] };

export const INDICATOR_GROUPS: readonly IndicatorGroup[] =
  INDICATOR_CATEGORIES.map(({ id, name }) => ({
    id,
    name,
    indicators: SIMULATION_INDICATORS.filter(indicator => indicator.categoryId === id)
  })).filter(group => group.indicators.length > 0);

/** 步行分钟数的距离（米）；Excel 只有 5、10、15 分钟三档 */
export function walkMeters(minutes: number): number {
  const meters = WALK_METERS[minutes];
  if (meters === undefined) {
    throw new Error(`没有步行 ${minutes} 分钟的距离档`);
  }
  return meters;
}

/** 标准口径的服务距离（米）；人均类没有 */
export function reachMeters(indicator: SimulationIndicator): number | null {
  if (indicator.model !== 'coverage') {
    return null;
  }
  return indicator.reach.kind === 'walk' ? walkMeters(indicator.reach.minutes) : indicator.reach.meters;
}

const distanceText = (meters: number) => (meters >= 1000 ? `${meters / 1000} 公里` : `${meters} 米`);

/** 服务范围的说明：如"步行 15 分钟（1000 米）""车行 5 分钟（3 公里）""2 公里缓冲区"；步行写米，同 Excel */
export function reachText(indicator: SimulationIndicator): string {
  if (indicator.model !== 'coverage') {
    return '面积 ÷ 人口';
  }
  const { reach } = indicator;
  switch (reach.kind) {
    case 'walk':
      return `步行 ${reach.minutes} 分钟（${walkMeters(reach.minutes)} 米）`;
    case 'drive':
      return `车行 ${reach.minutes} 分钟（${distanceText(reach.meters)}）`;
    case 'radius':
      break;
  }
  return `${distanceText(reach.meters)}缓冲区`;
}
