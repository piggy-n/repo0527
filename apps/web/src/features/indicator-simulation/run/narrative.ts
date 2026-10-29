import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { STEP_GROUPS, type StepGroupId, type StepId } from '../engine/steps';
import { formatDelta, formatValue } from '../format';
import { indicatorResult } from '../model/analysis';
import type { Calculator } from '../model/calculator';
import type { District } from '../model/districts';
import { facilityLayoutOf } from '../model/facilities';
import { simulationIndicator } from '../model/indicators';
import {
  defaultParams,
  describeParam,
  isScenario,
  paramApplies,
  PARAM_LABELS,
  type ParamKey,
  scenarioKeys,
  serviceMeters,
  signedPercent,
  type SimulationConditions,
  type SimulationParams
} from '../model/params';

/** 带强调的一段文字：强调的部分是推演得出的数字和对象 */
export type RichPart = string | { readonly em: string };
export type Rich = readonly RichPart[];

export const em = (value: string | number): RichPart => ({ em: String(value) });

/** 拼一段文字：用 em() 插入的部分强调，其余原样 */
export function rich(strings: TemplateStringsArray, ...values: readonly (RichPart | number)[]): Rich {
  const parts: RichPart[] = [];
  strings.forEach((text, index) => {
    if (text !== '') {
      parts.push(text);
    }
    const value = values[index];
    if (value !== undefined) {
      parts.push(typeof value === 'number' ? String(value) : value);
    }
  });
  return parts;
}

export const plainText = (text: Rich): string => text.map(part => (typeof part === 'string' ? part : part.em)).join('');

/** 分析过程的一句：所属步骤的进度到 at 时出现 */
export interface NarrativeLine {
  readonly step: StepId;
  readonly at: number;
  readonly text: Rich;
}

/** 正在用的工具：进度到 doneAt 时完成 */
export interface NarrativeTool {
  readonly step: StepId;
  readonly label: string;
  readonly doneAt: number;
}

/** 一段分析：数据准备的人口、设施、用地各一段，其余步骤一段 */
export interface NarrativeBlock {
  readonly label: string | null;
  readonly tools: readonly NarrativeTool[];
  readonly lines: readonly NarrativeLine[];
}

/** 一个数字：进度到 at 时出现，界面从 0 滚到 value */
export interface Metric {
  readonly step: StepId;
  readonly at: number;
  readonly label: string;
  readonly value: number;
  readonly format: (value: number) => string;
}

/** 用到的参数；和基准不同时 from 是原值 */
export interface ParamChip {
  readonly label: string;
  readonly value: string;
  readonly from: string | null;
}

/** 一步的记录：分析过程、数据、计算依据、参数，以及每个子步骤完成后的摘要 */
export interface StepRecord {
  readonly blocks: readonly NarrativeBlock[];
  readonly metrics: readonly Metric[];
  readonly basis: readonly Rich[];
  readonly params: readonly ParamChip[];
  readonly summaries: Readonly<Partial<Record<StepId, string>>>;
}

/** 生成记录需要的状态：都来自引擎的快照 */
export interface NarrativeInput {
  readonly calculator: Calculator;
  readonly conditions: SimulationConditions;
  readonly params: SimulationParams;
  readonly baseParams: SimulationParams;
  /** 这一轮生成第几版（从 1 开始）：结论生成的摘要写它 */
  readonly version: number;
}

const formatNumber = (value: number): string => Math.round(value).toLocaleString('zh-CN');
const count = (unit: string) => (value: number) => `${Math.round(value)} ${unit}`;
const cityName = (code: string): string => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code;
const latestYear = ({ years }: SimulationConditions): number => Math.max(...years);
const coverageIds = ({ indicatorIds }: SimulationConditions): string[] =>
  indicatorIds.filter(id => simulationIndicator(id).model === 'coverage');

/** 主指标：第一项覆盖率类，没有时是第一项指标；样例和结论围绕它 */
export const primaryIndicator = (conditions: SimulationConditions): string =>
  coverageIds(conditions)[0] ?? conditions.indicatorIds[0] ?? '';

function scopeText({ cityCodes }: SimulationConditions): string {
  if (cityCodes.length === JIANGSU_CITIES.length) {
    return `全省 ${cityCodes.length} 市`;
  }
  return cityCodes.length <= 3 ? cityCodes.map(cityName).join('、') : `${cityCodes.length} 个市`;
}

// 所选指标用得上这一项参数时，列出它的取值；和基准不同时带上原值
function paramChips(keys: readonly ParamKey[], input: NarrativeInput): ParamChip[] {
  const { conditions, params, baseParams } = input;
  return keys
    .filter(key => conditions.indicatorIds.some(id => paramApplies(key, id)))
    .map(key => {
      const value = describeParam(key, params, conditions);
      const before = describeParam(key, baseParams, conditions);
      return { label: PARAM_LABELS[key], value, from: value === before ? null : before };
    });
}

/** 参数项的改动说明，如"计算规程 新规程 → 旧规程" */
export function describeChanges(
  keys: readonly ParamKey[],
  from: SimulationParams,
  to: SimulationParams,
  conditions: SimulationConditions
): string[] {
  return keys.map(
    key => `${PARAM_LABELS[key]} ${describeParam(key, from, conditions)} → ${describeParam(key, to, conditions)}`
  );
}

/** 一项指标偏离标准口径的说明，如"旧规程、相交即算" */
const scenarioText = (params: SimulationParams, id: string, conditions: SimulationConditions): string =>
  scenarioKeys(params, id)
    .map(key => describeParam(key, params, conditions))
    .join('、');

function parseRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator, params } = input;
  const { years, cityCodes, indicatorIds } = conditions;
  const coverage = coverageIds(conditions).length;
  const districts = calculator.atlas.inCities(cityCodes).length;
  const yearsText = years.toSorted((a, b) => a - b).join('、');
  const scenarios = indicatorIds.filter(id => isScenario(params, id));
  const lines: NarrativeLine[] = [
    {
      step: 'parse',
      at: 0.05,
      text: rich`推演 ${em(`${yearsText} 年`)} · ${em(scopeText(conditions))} · ${em(`${indicatorIds.length} 项指标`)}：${indicatorIds.map(id => simulationIndicator(id).short).join('、')}。`
    },
    {
      step: 'parse',
      at: 0.5,
      text: rich`其中 ${em(coverage)} 项覆盖率按服务范围推演，${em(indicatorIds.length - coverage)} 项人均值按用地面积与人口推演；规划 ${em(STEP_GROUPS.length)} 个步骤，数据准备 3 路并行。`
    }
  ];
  if (scenarios.length > 0) {
    const first = scenarios[0] ?? '';
    lines.push({
      step: 'parse',
      at: 0.7,
      text: rich`${em(simulationIndicator(first).short)}${scenarios.length > 1 ? ` 等 ${scenarios.length} 项` : ''}按模拟情景推演（${em(scenarioText(params, first, conditions))}），不改指标的标准定义。`
    });
  }
  return {
    blocks: [{ label: null, tools: [{ step: 'parse', label: '任务理解', doneAt: 0.6 }], lines }],
    metrics: [
      { step: 'parse', at: 0.05, label: '年度', value: years.length, format: count('个') },
      { step: 'parse', at: 0.05, label: '城市', value: cityCodes.length, format: count('市') },
      { step: 'parse', at: 0.05, label: '区县', value: districts, format: count('个') },
      { step: 'parse', at: 0.05, label: '指标', value: indicatorIds.length, format: count('项') }
    ],
    basis: [
      rich`覆盖率类：服务范围覆盖的住宅用地 ÷ 住宅用地`,
      rich`人均类：用地面积 ÷ 城区七普常住人口`,
      rich`计算方法取自《城市国土空间监测指标计算方法合集》`
    ],
    params: [],
    summaries: { parse: `${years.length} 年 · ${cityCodes.length} 市 · ${indicatorIds.length} 项` }
  };
}

function prepRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator, params } = input;
  const { years, cityCodes, indicatorIds } = conditions;
  const year = latestYear(conditions);
  const list = calculator.atlas.inCities(cityCodes);
  const census = list.reduce((sum, district) => sum + calculator.districtPopulation(district), 0);
  const population = census * (1 + params.popChange / 100);
  const changed = params.popChange !== 0 && indicatorIds.some(id => paramApplies('popChange', id));
  // 每类设施取第一项用它的指标
  const facilityIds = [...new Map(indicatorIds.map(id => [simulationIndicator(id).facility, id])).values()];
  const layout = facilityLayoutOf(calculator);
  const facilityCounts = facilityIds.map(id => ({
    facility: simulationIndicator(id).facility,
    total: layout.total(conditions, id, year)
  }));
  const facilities = facilityCounts.reduce((sum, item) => sum + item.total, 0);
  const listed = facilityCounts
    .slice(0, 3)
    .map(item => `${item.facility} ${formatNumber(item.total)} 处`)
    .join('、');
  const land = list.reduce((sum, district) => sum + calculator.residentialLand(district), 0);
  return {
    blocks: [
      {
        label: '人口',
        tools: [{ step: 'pop', label: '人口库 · 七普常住人口', doneAt: 0.7 }],
        lines: [
          {
            step: 'pop',
            at: 0.3,
            text: rich`读取 ${em(cityCodes.length)} 个市城区所在区的七普常住人口，合计 ${em(`${census.toFixed(1)} 万人`)}，分解到 ${em(list.length)} 个区县${years.length > 1 ? `；各年度共用同一口径` : ''}。`
          },
          ...(changed
            ? [
                {
                  step: 'pop' as const,
                  at: 0.55,
                  text: rich`模拟情景：常住人口 ${em(signedPercent(params.popChange))}，按 ${em(`${population.toFixed(1)} 万人`)}计算人均值。`
                }
              ]
            : [])
        ]
      },
      {
        label: '设施',
        tools: [{ step: 'poi', label: `设施库 · ${facilityCounts.length} 类`, doneAt: 0.7 }],
        lines: [
          {
            step: 'poi',
            at: 0.3,
            text: rich`按计算方法的筛选条件载入${em(listed)}${facilityCounts.length > 3 ? ` 等 ${facilityCounts.length} 类` : ''}。`
          }
        ]
      },
      {
        label: '用地',
        tools: [{ step: 'land', label: '国土变更调查 · 住宅用地', doneAt: 0.7 }],
        lines: [
          {
            step: 'land',
            at: 0.3,
            text: rich`载入 ${em(list.length)} 个区县的城镇住宅用地和农村宅基地，合计 ${em(`${formatNumber(land)} 平方千米`)}。`
          }
        ]
      }
    ],
    metrics: [],
    basis: [
      rich`人口：城区所在区的七普常住人口（演示数据）按区县分解`,
      rich`设施：按计算方法写明的图层和筛选条件`,
      rich`用地：国土变更调查的城镇住宅用地、农村宅基地`
    ],
    params: paramChips(['popChange'], input),
    summaries: {
      pop: `${formatNumber(population)} 万人`,
      poi: `${formatNumber(facilities)} 处`,
      land: `${list.length} 个区县`
    }
  };
}

function qcRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator } = input;
  const list = calculator.atlas.inCities(conditions.cityCodes);
  const records = list.length * 3 * conditions.years.length;
  return {
    blocks: [
      {
        label: null,
        tools: [{ step: 'qc', label: '完整性检查', doneAt: 0.9 }],
        lines: [
          {
            step: 'qc',
            at: 0.1,
            text: rich`核查人口、设施、用地 3 类数据共 ${em(formatNumber(records))} 条记录。`
          },
          {
            step: 'qc',
            at: 0.45,
            text: rich`${em(list.length)} 个区县的人口、设施坐标和住宅用地都齐全，没有缺失。`
          }
        ]
      }
    ],
    metrics: [{ step: 'qc', at: 0.1, label: '记录', value: records, format: formatNumber }],
    basis: [rich`完整性规则：每个区县的人口、设施坐标、住宅用地三项齐全`, rich`人口用七普，不随年份缺失`],
    params: [],
    summaries: { qc: '数据完整' }
  };
}

function spatialRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator, params } = input;
  const year = latestYear(conditions);
  const id = primaryIndicator(conditions);
  const indicator = simulationIndicator(id);
  const firstCity = conditions.cityCodes[0] ?? '';
  const candidates = calculator.atlas.inCities([firstCity]);
  // 样例：第一个市里人口最密的市辖区
  const density = (district: District) => calculator.districtPopulation(district) / district.area;
  const urban = candidates.filter(district => district.urban).toSorted((a, b) => density(b) - density(a));
  const sample = urban[0] ?? candidates[0];
  const coverage = coverageIds(conditions);
  const districts = calculator.atlas.inCities(conditions.cityCodes).length;
  const meters = serviceMeters(id, params);
  const radii = [...new Set(coverage.map(item => serviceMeters(item, params) ?? 0))];
  radii.sort((a, b) => a - b);
  const lines: NarrativeLine[] = [];
  const metrics: Metric[] = [];
  if (sample) {
    const row = indicatorResult(calculator.computeYear(conditions, params, year).indicators, id).rows.find(
      item => item.code === sample.code
    );
    const facilities = facilityLayoutOf(calculator)
      .points(conditions, id, year)
      .filter(point => point.districtCode === sample.code).length;
    const value = row ? formatValue(row.value, indicator) : '—';
    const covered = indicator.model === 'coverage' && indicator.base === 'area' ? '城区面积' : '住宅用地';
    lines.push({
      step: 'spatial',
      at: 0.15,
      text:
        meters === null
          ? rich`以 ${em(sample.name)} 为样例：汇总 ${em(facilities)} 处${indicator.facility}的用地面积，人均 ${em(value)}。`
          : rich`以 ${em(sample.name)} 为样例：${em(facilities)} 处${indicator.facility}生成 ${em(`${meters} 米`)}服务范围，覆盖${covered} ${em(value)}。`
    });
    metrics.push(
      { step: 'spatial', at: 0.15, label: '样例设施', value: facilities, format: count('处') },
      {
        step: 'spatial',
        at: 0.15,
        label: '服务范围',
        value: meters ?? 0,
        format: radius => (meters === null ? '—' : `${Math.round(radius)} 米`)
      },
      {
        step: 'spatial',
        at: 0.15,
        label: '样例结果',
        value: row?.value ?? 0,
        format: result => formatValue(result, indicator)
      }
    );
  }
  if (params.rule === 'old' && conditions.indicatorIds.some(item => paramApplies('rule', item))) {
    lines.push({
      step: 'spatial',
      at: 0.45,
      text: rich`模拟情景：按 ${em('旧规程')}，卫生服务站、文化活动站按步行 5 分钟（300 米），服务中心仍为 15 分钟。`
    });
  }
  if (params.recognition === 'intersect' && conditions.indicatorIds.some(item => paramApplies('recognition', item))) {
    lines.push({
      step: 'spatial',
      at: 0.55,
      text: rich`模拟情景：覆盖认定改为 ${em('相交即算')}，与服务范围相交的住宅图斑都算覆盖。`
    });
  }
  lines.push({
    step: 'spatial',
    at: 0.75,
    text:
      coverage.length > 0
        ? rich`完成 ${em(districts)} 个区县 × ${em(coverage.length)} 项覆盖率的服务范围叠加分析。`
        : rich`人均类指标按区县汇总用地面积，不需要服务范围分析。`
  });
  return {
    blocks: [
      {
        label: null,
        tools: [
          { step: 'spatial', label: '服务区分析', doneAt: 0.6 },
          { step: 'spatial', label: '叠加分析', doneAt: 0.9 }
        ],
        lines
      }
    ],
    metrics,
    basis: [
      rich`步行 5、10、15 分钟分别按 300、500、1000 米（计算方法的服务区阻抗）`,
      rich`覆盖率 = 服务范围覆盖的住宅用地 ÷ 住宅用地`,
      rich`覆盖认定：覆盖面积 ≥ 50% 的住宅图斑算覆盖`
    ],
    params: paramChips(['rule', 'recognition'], input),
    summaries: { spatial: radii.length > 0 ? `服务范围 ${radii.slice(0, 3).join('/')} 米` : '面积汇总完成' }
  };
}

function computeRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator, params } = input;
  const { years, indicatorIds } = conditions;
  const year = latestYear(conditions);
  const districts = calculator.atlas.inCities(conditions.cityCodes).length;
  const latest = calculator.computeYear(conditions, params, year).indicators;
  const shown = indicatorIds.slice(0, 3);
  const values = shown.map(id => {
    const indicator = simulationIndicator(id);
    return `${indicator.short} ${formatValue(indicatorResult(latest, id).value, indicator)}`;
  });
  return {
    blocks: [
      {
        label: null,
        tools: [{ step: 'compute', label: '指标计算', doneAt: 0.85 }],
        lines: [
          {
            step: 'compute',
            at: 0.1,
            text: rich`计算 ${em(years.length)} 个年度 × ${em(indicatorIds.length)} 项指标 × ${em(districts)} 个区县，再汇总到市和全省：覆盖率按住宅用地面积、人均值按人口加权。`
          },
          {
            step: 'compute',
            at: 0.5,
            text: rich`${year} 年全省：${em(values.join('，'))}${indicatorIds.length > 3 ? ` 等 ${indicatorIds.length} 项` : ''}。`
          }
        ]
      }
    ],
    metrics: shown.map(id => {
      const indicator = simulationIndicator(id);
      return {
        step: 'compute',
        at: 0.5,
        label: indicator.short,
        value: indicatorResult(latest, id).value,
        format: (value: number) => formatValue(value, indicator)
      };
    }),
    basis: [
      rich`覆盖率 = 1 − (1 − 标准值)^k；旧规程 k × 0.6，相交即算 k × 1.25`,
      rich`人均 = 标准值 ÷ (1 + 常住人口变化)`,
      rich`区县 → 市 → 全省：覆盖率按住宅用地面积（消防、派出所按城区面积）、人均值按人口加权`
    ],
    params: paramChips(['popChange', 'rule', 'recognition'], input),
    summaries: { compute: `${years.length * indicatorIds.length} 组 × ${districts} 区县` }
  };
}

function evaluateRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator, params, baseParams } = input;
  const year = latestYear(conditions);
  const all = calculator.compute(conditions, params);
  const result = all[year]?.indicators ?? {};
  const sorted = conditions.years.toSorted((a, b) => a - b);
  const previous = sorted.length > 1 ? sorted.at(-2) : undefined;
  const shown = conditions.indicatorIds.slice(0, 3);
  const primary = indicatorResult(result, primaryIndicator(conditions));
  return {
    blocks: [
      {
        label: null,
        tools: [{ step: 'evaluate', label: '目标对照', doneAt: 0.85 }],
        lines: shown.map((id, index) => {
          const indicator = simulationIndicator(id);
          const data = indicatorResult(result, id);
          const before = previous === undefined ? undefined : all[previous]?.indicators;
          const trend =
            previous !== undefined && before
              ? `，较 ${previous} 年达标 ${indicatorResult(before, id).passCount} → ${data.passCount} 市`
              : '';
          return {
            step: 'evaluate',
            at: 0.15 + index * 0.25,
            text: rich`${indicator.short}：达标 ${em(`${data.passCount}/${data.total}`)} 市，最低 ${em(`${data.lowest.name} ${formatValue(data.lowest.value, indicator)}`)}${trend}。`
          };
        })
      }
    ],
    metrics: shown.map(id => {
      const data = indicatorResult(result, id);
      return {
        step: 'evaluate',
        at: 0.15,
        label: `${simulationIndicator(id).short}达标`,
        value: data.passCount,
        format: (value: number) => `${Math.round(value)}/${data.total}`
      };
    }),
    basis: [
      rich`达标：城市值 ≥ 目标值`,
      rich`接近：差距在目标值的 5% 以内`,
      rich`目标值默认取 2026 年城市值的中位数，不代表规范标准`
    ],
    params: conditions.indicatorIds.slice(0, 4).map(id => {
      const target = params.targets[id];
      const before = baseParams.targets[id];
      return {
        label: `${simulationIndicator(id).short}目标`,
        value: String(target),
        from: target === before ? null : String(before)
      };
    }),
    summaries: { evaluate: `达标 ${primary.passCount}/${primary.total} 市` }
  };
}

function reportRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator, params, version } = input;
  const year = latestYear(conditions);
  const id = primaryIndicator(conditions);
  const indicator = simulationIndicator(id);
  const data = indicatorResult(calculator.computeYear(conditions, params, year).indicators, id);
  const weak = data.cities
    .filter(city => !city.pass)
    .toSorted((a, b) => a.value - b.value)
    .slice(0, 2);
  const lines: NarrativeLine[] = [
    {
      step: 'report',
      at: 0.15,
      text: rich`结论：${year} 年${indicator.short}全省 ${em(formatValue(data.value, indicator))}，${em(`${data.passCount}/${data.total}`)} 市达到目标${weak.length > 0 ? '；短板集中在 ' : '，全部达标'}${weak.length > 0 ? em(weak.map(city => city.name).join('、')) : ''}。`
    }
  ];
  const metrics: Metric[] = [];
  // 模拟情景和标准口径对比：同样的条件按标准口径再算一遍
  if (isScenario(params, id)) {
    const standard = indicatorResult(
      calculator.computeYear(conditions, { ...defaultParams(), targets: params.targets }, year).indicators,
      id
    );
    lines.push({
      step: 'report',
      at: 0.55,
      text: rich`模拟情景（${scenarioText(params, id, conditions)}）较标准口径 ${em(formatDelta(data.value - standard.value, indicator))}：全省 ${em(`${formatValue(standard.value, indicator)} → ${formatValue(data.value, indicator)}`)}，达标 ${em(`${standard.passCount} → ${data.passCount}`)} 市。`
    });
    metrics.push(
      {
        step: 'report',
        at: 0.55,
        label: '标准口径',
        value: standard.value,
        format: value => formatValue(value, indicator)
      },
      {
        step: 'report',
        at: 0.55,
        label: '模拟情景',
        value: data.value,
        format: value => formatValue(value, indicator)
      },
      { step: 'report', at: 0.55, label: '标准达标', value: standard.passCount, format: count('市') }
    );
  }
  return {
    blocks: [{ label: null, tools: [{ step: 'report', label: '生成结论', doneAt: 0.85 }], lines }],
    metrics,
    basis: [rich`模拟情景只改这次推演，不改指标的标准定义；结论同时给出标准口径的值`],
    params: [],
    summaries: { report: `v${version} 已生成` }
  };
}

const RECORDS: Readonly<Record<StepGroupId, (input: NarrativeInput) => StepRecord>> = {
  parse: parseRecord,
  prep: prepRecord,
  qc: qcRecord,
  spatial: spatialRecord,
  compute: computeRecord,
  evaluate: evaluateRecord,
  report: reportRecord
};

/** 一步的记录：所有数字都来自同一份计算，同样的状态得到同样的叙述 */
export function stepRecord(group: StepGroupId, input: NarrativeInput): StepRecord {
  return RECORDS[group](input);
}
