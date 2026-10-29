import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import type { CheckpointStep } from '../engine/engine';
import { STEP_GROUPS, type StepGroupId, type StepId } from '../engine/steps';
import { formatValue } from '../format';
import { indicatorResult, suggestion } from '../model/analysis';
import type { Calculator } from '../model/calculator';
import type { District } from '../model/districts';
import { facilityLayoutOf } from '../model/facilities';
import { reachMeters, simulationIndicator } from '../model/indicators';
import {
  CALIBER_LABELS,
  describeParam,
  MISSING_LABELS,
  PARAM_LABELS,
  type ParamKey,
  SCOPE_LABELS,
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
  readonly decided: Readonly<Record<CheckpointStep, boolean>>;
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

function paramChip(key: ParamKey, input: NarrativeInput): ParamChip {
  const value = describeParam(key, input.params, input.conditions);
  const before = describeParam(key, input.baseParams, input.conditions);
  return { label: PARAM_LABELS[key], value, from: value === before ? null : before };
}

/** 参数项的改动说明，如"步行速度 60 米/分钟 → 75 米/分钟" */
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

function parseRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator } = input;
  const { years, cityCodes, indicatorIds } = conditions;
  const coverage = coverageIds(conditions).length;
  const districts = calculator.atlas.inCities(cityCodes).length;
  const yearsText = years.toSorted((a, b) => a - b).join('、');
  return {
    blocks: [
      {
        label: null,
        tools: [{ step: 'parse', label: '任务理解', doneAt: 0.6 }],
        lines: [
          {
            step: 'parse',
            at: 0.05,
            text: rich`推演 ${em(`${yearsText} 年`)} · ${em(scopeText(conditions))} · ${em(`${indicatorIds.length} 项指标`)}：${indicatorIds.map(id => simulationIndicator(id).short).join('、')}。`
          },
          {
            step: 'parse',
            at: 0.5,
            text: rich`其中 ${em(coverage)} 项覆盖率按服务圈推演，${em(indicatorIds.length - coverage)} 项人均值按设施面积与人口推演；规划 ${em(STEP_GROUPS.length)} 个步骤，数据准备 3 路并行。`
          }
        ]
      }
    ],
    metrics: [
      { step: 'parse', at: 0.05, label: '年度', value: years.length, format: count('个') },
      { step: 'parse', at: 0.05, label: '城市', value: cityCodes.length, format: count('市') },
      { step: 'parse', at: 0.05, label: '区县', value: districts, format: count('个') },
      { step: 'parse', at: 0.05, label: '指标', value: indicatorIds.length, format: count('项') }
    ],
    basis: [rich`覆盖率类：服务圈覆盖的常住人口 ÷ 常住人口`, rich`人均类：设施面积 ÷ 人口`, rich`区县 → 市 → 全省：按人口加权汇总`],
    params: [],
    summaries: { parse: `${years.length} 年 · ${cityCodes.length} 市 · ${indicatorIds.length} 项` }
  };
}

function prepRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator, params } = input;
  const { years, cityCodes, indicatorIds } = conditions;
  const year = latestYear(conditions);
  const list = calculator.atlas.inCities(cityCodes);
  const caliber = CALIBER_LABELS[params.popCaliber];
  const population = list.reduce(
    (sum, district) => sum + calculator.districtPopulation(district, year, params.popCaliber),
    0
  );
  // 每类设施取第一项用它的指标
  const facilityIds = [...new Map(indicatorIds.map(id => [simulationIndicator(id).facility, id])).values()];
  const layout = facilityLayoutOf(calculator);
  const facilityCounts = facilityIds.map(id => ({
    facility: simulationIndicator(id).facility,
    total: layout.total(conditions, id, params, year)
  }));
  const facilities = facilityCounts.reduce((sum, item) => sum + item.total, 0);
  const listed = facilityCounts
    .slice(0, 3)
    .map(item => `${item.facility} ${formatNumber(item.total)} 处`)
    .join('、');
  const area = list.reduce((sum, district) => sum + district.area, 0);
  return {
    blocks: [
      {
        label: '人口',
        tools: [{ step: 'pop', label: `人口库 · ${caliber}`, doneAt: 0.7 }],
        lines: [
          {
            step: 'pop',
            at: 0.3,
            text: rich`读取 ${em(cityCodes.length)} 个市${caliber}，${year} 年合计 ${em(`${population.toFixed(1)} 万人`)}，分解到 ${em(list.length)} 个区县${years.length > 1 ? `；另读取 ${years.length - 1} 个年度用于对比` : ''}。`
          }
        ]
      },
      {
        label: '设施',
        tools: [{ step: 'poi', label: `设施库 · ${facilityCounts.length} 类`, doneAt: 0.7 }],
        lines: [
          {
            step: 'poi',
            at: 0.3,
            text: rich`载入${em(listed)}${facilityCounts.length > 3 ? ` 等 ${facilityCounts.length} 类` : ''}（${SCOPE_LABELS[params.facilityScope]}）。`
          }
        ]
      },
      {
        label: '用地',
        tools: [{ step: 'land', label: '国土调查 · 城区范围', doneAt: 0.7 }],
        lines: [
          {
            step: 'land',
            at: 0.3,
            text: rich`载入 ${em(list.length)} 个区县的城区范围与用地现状，国土面积 ${em(`${formatNumber(area)} 平方千米`)}。`
          }
        ]
      }
    ],
    metrics: [],
    basis: [rich`人口：人口库（演示数据）按区县分解`, rich`设施：设施库按纳入口径筛选`, rich`用地：国土调查城区范围`],
    params: [paramChip('popCaliber', input), paramChip('facilityScope', input)],
    summaries: {
      pop: `${formatNumber(population)} 万人`,
      poi: `${formatNumber(facilities)} 处`,
      land: `${list.length} 个区县`
    }
  };
}

function qcRecord(input: NarrativeInput): StepRecord {
  const { conditions, calculator, params, decided } = input;
  const year = latestYear(conditions);
  const list = calculator.atlas.inCities(conditions.cityCodes);
  const missing = calculator.missingDistricts(year, conditions.cityCodes);
  const records = list.length * 3 * conditions.years.length;
  const treatment = MISSING_LABELS[params.missing.kind];
  const lines: NarrativeLine[] = [
    {
      step: 'qc',
      at: 0.1,
      text: rich`核查人口、设施、用地 3 类数据共 ${em(formatNumber(records))} 条记录，设施坐标与城区范围完整。`
    }
  ];
  if (missing.length === 0) {
    lines.push({ step: 'qc', at: 0.4, text: rich`所选范围的人口数据齐全，没有缺失。` });
  } else {
    const names = missing.map(district => `${district.name}（${cityName(district.cityCode)}）`).join('、');
    lines.push({ step: 'qc', at: 0.35, text: rich`发现 ${em(missing.length)} 个区县缺少 ${em(`${year} 年`)}人口：${em(names)}。` });
    // 停在确认点（一半处）之后才出现；决定过才有这一句
    if (decided.qc) {
      lines.push({ step: 'qc', at: 0.55, text: rich`按人工确认：${em(treatment)}，继续推演。` });
    }
  }
  const summaries: Record<typeof params.missing.kind, string> = {
    impute: `缺失 ${missing.length} 处 · 已插补`,
    exclude: `已剔除 ${missing.length} 个区县`,
    manual: '缺失人口已手动填写'
  };
  return {
    blocks: [{ label: null, tools: [{ step: 'qc', label: '完整性检查', doneAt: 0.9 }], lines }],
    metrics: [
      { step: 'qc', at: 0.1, label: '记录', value: records, format: formatNumber },
      { step: 'qc', at: 0.35, label: '缺失区县', value: missing.length, format: count('个') }
    ],
    basis: [
      rich`完整性规则：每个区县的人口、设施坐标、城区范围三项齐全`,
      rich`缺失只出现在最新年度（${year} 年人口尚未全部入库）`
    ],
    params: missing.length > 0 && decided.qc ? [paramChip('missing', input)] : [],
    summaries: { qc: missing.length === 0 ? '数据完整' : summaries[params.missing.kind] }
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
  const density = (district: District) => calculator.districtPopulation(district, year, 'resident') / district.area;
  const urban = candidates.filter(district => district.urban).toSorted((a, b) => density(b) - density(a));
  const sample = urban[0] ?? candidates[0];
  const coverage = coverageIds(conditions);
  const districts = calculator.atlas.inCities(conditions.cityCodes).length;
  const meters = reachMeters(indicator, params.walkSpeed);
  const radii = [...new Set(coverage.map(item => reachMeters(simulationIndicator(item), params.walkSpeed) ?? 0))];
  radii.sort((a, b) => a - b);
  const lines: NarrativeLine[] = [];
  const metrics: Metric[] = [];
  if (sample) {
    const row = indicatorResult(calculator.computeYear(conditions, params, year).indicators, id).rows.find(
      item => item.code === sample.code
    );
    const facilities = facilityLayoutOf(calculator)
      .points(conditions, id, params, year)
      .filter(point => point.districtCode === sample.code).length;
    const value = row ? formatValue(row.value, indicator) : '—';
    lines.push({
      step: 'spatial',
      at: 0.15,
      text:
        meters === null
          ? rich`以 ${em(sample.name)} 为样例：汇总 ${em(facilities)} 处${indicator.facility}的面积，人均 ${em(value)}。`
          : rich`以 ${em(sample.name)} 为样例：${em(facilities)} 处${indicator.facility}生成 ${em(`${meters} 米`)}服务圈，覆盖常住人口 ${em(value)}。`
    });
    metrics.push(
      { step: 'spatial', at: 0.15, label: '样例设施', value: facilities, format: count('处') },
      {
        step: 'spatial',
        at: 0.15,
        label: '服务半径',
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
  if (params.newFacilities > 0) {
    lines.push({
      step: 'spatial',
      at: 0.5,
      text: rich`叠加规划新增 ${em(`${params.newFacilities}%`)} 设施（紫色），服务圈之间的空白明显减少。`
    });
  }
  lines.push({
    step: 'spatial',
    at: 0.75,
    text:
      coverage.length > 0
        ? rich`完成 ${em(districts)} 个区县 × ${em(coverage.length)} 项覆盖率的服务圈叠加分析。`
        : rich`人均类指标按区县汇总设施面积，不需要服务圈分析。`
  });
  return {
    blocks: [
      {
        label: null,
        tools: [
          { step: 'spatial', label: '缓冲区分析', doneAt: 0.6 },
          { step: 'spatial', label: '叠加分析', doneAt: 0.9 }
        ],
        lines
      }
    ],
    metrics,
    basis: [
      rich`服务半径 = 步行速度 × 分钟数（固定距离类不变）`,
      rich`覆盖率 = 服务圈覆盖的常住人口 ÷ 常住人口`,
      rich`规划新增：在现有设施附近按比例补点`
    ],
    params: [paramChip('walkSpeed', input), paramChip('facilityScope', input), paramChip('newFacilities', input)],
    summaries: { spatial: radii.length > 0 ? `服务圈 ${radii.slice(0, 3).join('/')} 米` : '面积汇总完成' }
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
            text: rich`计算 ${em(years.length)} 个年度 × ${em(indicatorIds.length)} 项指标 × ${em(districts)} 个区县，再按人口加权汇总到市和全省。`
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
      rich`覆盖率 = 1 − (1 − 基准)^((v ÷ 60)² × 口径系数 × (1 + 新增))`,
      rich`人均 = 基准 × 面积口径系数 × (1 + 新增) × 常住人口 ÷ 所选口径人口`,
      rich`区县 → 市 → 全省：按${CALIBER_LABELS[params.popCaliber]}加权`
    ],
    params: [paramChip('popCaliber', input), paramChip('walkSpeed', input), paramChip('newFacilities', input)],
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
      rich`达标：城市值 ≥ 演示目标值`,
      rich`接近：差距在目标值的 5% 以内`,
      rich`演示目标值取 2026 年城市值的中位数，不代表规范标准`
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
      text: rich`结论：${year} 年${indicator.short}全省 ${em(formatValue(data.value, indicator))}，${em(`${data.passCount}/${data.total}`)} 市达到演示目标${weak.length > 0 ? '；短板集中在 ' : '，全部达标'}${weak.length > 0 ? em(weak.map(city => city.name).join('、')) : ''}。`
    }
  ];
  const metrics: Metric[] = [];
  const idea = suggestion(calculator, conditions, params, id, year);
  if (idea) {
    lines.push({
      step: 'report',
      at: 0.55,
      text: rich`${idea.reached ? '建议情景' : '仅靠新增设施难以达标，上限情景'}：规划新增 ${em(`${idea.add}%`)} ${indicator.facility}，预计全省 ${em(`${formatValue(idea.before.value, indicator)} → ${formatValue(idea.after.value, indicator)}`)}，达标 ${em(`${idea.before.passCount} → ${idea.after.passCount}`)} 市。`
    });
    metrics.push(
      { step: 'report', at: 0.55, label: '建议新增', value: idea.add, format: value => `${Math.round(value)}%` },
      {
        step: 'report',
        at: 0.55,
        label: '预计全省',
        value: idea.after.value,
        format: value => formatValue(value, indicator)
      },
      { step: 'report', at: 0.55, label: '预计达标', value: idea.after.passCount, format: count('市') }
    );
  }
  return {
    blocks: [{ label: null, tools: [{ step: 'report', label: '生成结论', doneAt: 0.85 }], lines }],
    metrics,
    basis: [rich`建议情景：在 0～50% 新增设施里找最小的、能让全省达标或多约四分之一城市达标的比例`],
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
