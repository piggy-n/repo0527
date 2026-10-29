import type { EngineState, SimulationVersion } from '../engine/engine';
import { formatDelta, formatValue } from '../format';
import {
  type Contribution,
  contributions,
  indicatorResult,
  passState,
  type Sensitivity,
  sensitivity,
  type Suggestion,
  suggestion,
  valueBreaks
} from '../model/analysis';
import type { Calculator, DistrictResult, IndicatorResult, YearResult } from '../model/calculator';
import { simulationIndicator } from '../model/indicators';
import { defaultParams, PARAM_LABELS, type SimulationConditions, type SimulationParams } from '../model/params';
import { DIFF_COLORS, diffColor, diffEdges, EXCLUDED_COLOR, PASS_COLORS, VALUE_COLORS, valueColor } from '../map/colors';
import { describeChanges, em, primaryIndicator, type Rich, rich } from '../run/narrative';

/** 结果地图的着色：数值五档、达标三态、和对比版本的差值 */
export type MapMode = 'value' | 'pass' | 'diff';

/** 结果阶段在看什么：哪一版、和谁比、哪项指标、哪一年、地图怎么着色 */
export interface ResultSelection {
  readonly viewIndex: number;
  /** 对比的版本序号；default 是默认参数 */
  readonly compare: number | 'default';
  readonly indicatorId: string;
  readonly year: number;
  readonly mode: MapMode;
}

/** 对比的一方 */
export interface Comparison {
  readonly label: string;
  readonly params: SimulationParams;
  readonly result: Readonly<Record<number, YearResult>>;
}

const DEFAULT_LABEL = '默认参数';

// 版本名 v1、v2 和汉字之间留空格
const spaced = (label: string) => (/^v\d/.test(label) ? ` ${label} ` : label);
// 数值后的单位：百分号紧跟，其他单位前空一格
const unitText = (unit: string) => (unit === '%' ? '%' : ` ${unit}`);

/** 新的一版生成后看它：和它所基于的版本比（第一版和默认参数比），主指标、最新年度、数值着色 */
export function initialSelection(state: EngineState): ResultSelection | null {
  const version = state.versions.at(-1);
  if (!version || !state.conditions) {
    return null;
  }
  return {
    viewIndex: version.index,
    compare: version.baseIndex ?? 'default',
    indicatorId: primaryIndicator(state.conditions),
    year: Math.max(...state.conditions.years),
    mode: 'value'
  };
}

/** 对比的一方：默认参数按同样的条件算一遍，版本直接用它的结果 */
export function comparisonOf(
  calculator: Calculator,
  conditions: SimulationConditions,
  versions: readonly SimulationVersion[],
  compare: number | 'default'
): Comparison {
  const version = compare === 'default' ? undefined : versions[compare];
  if (!version) {
    const params = defaultParams();
    return { label: DEFAULT_LABEL, params, result: calculator.compute(conditions, params) };
  }
  return { label: version.label, params: version.params, result: version.result };
}

/** 版本的说明：相对所基于的版本改了什么 */
export function versionText(version: SimulationVersion, conditions: SimulationConditions): string {
  const changes = describeChanges(version.changes, version.baseParams, version.params, conditions);
  return changes.length === 0 ? '编排时的参数' : changes.join('；');
}

export type Tone = 'up' | 'down' | 'flat';
const toneOf = (delta: number): Tone => (Math.abs(delta) < 0.005 ? 'flat' : delta > 0 ? 'up' : 'down');

/** 一个关键数字：值、单位、和对比的变化 */
export interface Kpi {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly delta: string;
  readonly tone: Tone;
}

export interface ResultSummary {
  readonly current: IndicatorResult;
  readonly base: IndicatorResult;
  readonly kpis: readonly Kpi[];
  /** AI 结论：结论一段，有建议时再一段 */
  readonly insight: readonly Rich[];
  readonly idea: Suggestion | null;
  readonly attribution: readonly Contribution[];
  readonly sensitivity: Sensitivity;
  readonly previousYear: number | null;
}

const indicatorOf = (result: Readonly<Record<number, YearResult>>, year: number, id: string): IndicatorResult =>
  indicatorResult(result[year]?.indicators ?? {}, id);

/** 结果面板的内容：所有数字来自同一份计算 */
export function resultSummary(
  calculator: Calculator,
  conditions: SimulationConditions,
  version: SimulationVersion,
  comparison: Comparison,
  indicatorId: string,
  year: number
): ResultSummary {
  const indicator = simulationIndicator(indicatorId);
  const current = indicatorOf(version.result, year, indicatorId);
  const base = indicatorOf(comparison.result, year, indicatorId);
  const delta = current.value - base.value;
  const passDelta = current.passCount - base.passCount;
  const years = conditions.years.toSorted((a, b) => a - b);
  const previousYear = years[years.indexOf(year) - 1] ?? null;
  const trend = previousYear === null ? null : current.value - indicatorOf(version.result, previousYear, indicatorId).value;
  const percent = indicator.unit === '%';
  const short = (value: number) => formatDelta(value, indicator).replace(' 个百分点', ' 点');
  // 三个数字并排只有 70 像素宽：和对比的一方相同写"持平"，对比的是谁在标题栏和悬停提示里
  const same = '持平';

  const kpis: Kpi[] = [
    {
      label: `${year} 年全省`,
      value: formatValue(current.value, indicator, false),
      unit: indicator.unit,
      delta: toneOf(delta) === 'flat' ? same : short(delta),
      tone: toneOf(delta)
    },
    {
      label: '达标城市',
      value: String(current.passCount),
      unit: `/ ${current.total}`,
      delta: passDelta === 0 ? same : `${passDelta > 0 ? '+' : '−'}${Math.abs(passDelta)} 市`,
      tone: passDelta === 0 ? 'flat' : passDelta > 0 ? 'up' : 'down'
    },
    previousYear === null || trend === null
      ? {
          label: '最低城市',
          value: current.lowest.name,
          unit: '',
          delta: formatValue(current.lowest.value, indicator),
          tone: 'flat'
        }
      : {
          label: `较 ${previousYear} 年`,
          value: formatDelta(trend, indicator).replace(` ${indicator.unit}`, '').replace(' 个百分点', ''),
          unit: percent ? '点' : indicator.unit,
          delta: '年度变化',
          tone: toneOf(trend)
        }
  ];

  const attribution = contributions(calculator, conditions, comparison.params, version.params, indicatorId, year);
  const top = attribution
    .filter(item => Math.abs(item.delta) > 0.005)
    .toSorted((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const weak = current.cities
    .filter(city => !city.pass)
    .toSorted((a, b) => a.value - b.value)
    .slice(0, 2);
  const target = version.params.targets[indicatorId] ?? current.target;
  const idea = suggestion(calculator, conditions, version.params, indicatorId, year);

  const insight: Rich[] = [
    [
      ...rich`${year} 年${indicator.short}全省 ${em(formatValue(current.value, indicator))}，${em(`${current.passCount}/${current.total}`)} 市达到演示目标 ${target}${unitText(indicator.unit)}`,
      ...(weak.length > 0 ? rich`，短板在 ${em(weak.map(city => city.name).join('、'))}` : []),
      '。',
      ...(top ? rich`较${spaced(comparison.label).trimEnd()} ${em(formatDelta(delta, indicator))}，主要来自${PARAM_LABELS[top.key]}（${top.from} → ${top.to}）。` : []),
      ...(trend !== null && previousYear !== null ? rich`较 ${previousYear} 年 ${em(formatDelta(trend, indicator))}。` : [])
    ]
  ];
  if (idea) {
    insight.push(
      rich`${idea.reached ? '建议情景' : '仅靠新增设施难以达标，上限情景'}：规划新增 ${em(`${idea.add}%`)} ${indicator.facility}，预计 ${em(`${formatValue(idea.before.value, indicator)} → ${formatValue(idea.after.value, indicator)}`)}，达标 ${em(`${idea.before.passCount} → ${idea.after.passCount}`)} 市。`
    );
  }

  return {
    current,
    base,
    kpis,
    insight,
    idea,
    attribution,
    sensitivity: sensitivity(calculator, conditions, version.params, indicatorId, year),
    previousYear
  };
}

/** 图例的一行：色块或设施点、服务圈 */
export interface LegendEntry {
  readonly color: string;
  readonly text: string;
  readonly shape: 'block' | 'dot' | 'ring';
}

export interface MapColoring {
  readonly fill: (row: DistrictResult) => string;
  readonly legend: { readonly title: string; readonly entries: readonly LegendEntry[]; readonly note: string | null };
}

// 剔除的区县总是灰色
const withExcluded = (color: (row: DistrictResult) => string) => (row: DistrictResult) =>
  row.excluded ? EXCLUDED_COLOR : color(row);

/** 结果地图的着色和图例：数值五档按默认参数的分位数（年度、版本之间可比），达标按演示目标，差值和对比的一方比 */
export function mapColoring(
  calculator: Calculator,
  conditions: SimulationConditions,
  selection: ResultSelection,
  version: SimulationVersion,
  comparison: Comparison
): MapColoring {
  const { indicatorId, year, mode } = selection;
  const indicator = simulationIndicator(indicatorId);
  const current = indicatorOf(version.result, year, indicatorId);
  const excluded = current.rows.some(row => row.excluded);
  const tail: LegendEntry[] = excluded ? [{ color: EXCLUDED_COLOR, text: '已剔除（人口缺失）', shape: 'block' }] : [];

  if (mode === 'pass') {
    const target = current.target;
    return {
      fill: withExcluded(row => PASS_COLORS[passState(row.value, target)]),
      legend: {
        title: `对照演示目标 ${target}${unitText(indicator.unit)}`,
        entries: [
          { color: PASS_COLORS.pass, text: '达标', shape: 'block' },
          { color: PASS_COLORS.near, text: '接近（差 5% 以内）', shape: 'block' },
          { color: PASS_COLORS.fail, text: '未达标', shape: 'block' },
          ...tail
        ],
        note: null
      }
    };
  }
  if (mode === 'diff') {
    const base = new Map(indicatorOf(comparison.result, year, indicatorId).rows.map(row => [row.code, row.value]));
    const deltaOf = (row: DistrictResult) => row.value - (base.get(row.code) ?? row.value);
    const maxAbs = Math.max(0, ...current.rows.map(row => Math.abs(deltaOf(row))));
    const edges = diffEdges(maxAbs);
    const digits = indicator.unit === '%' ? 1 : 2;
    const same = maxAbs < 0.005;
    const labels = ['明显上升', '上升', same ? '基本不变' : `基本不变（±${(edges[2] ?? 0).toFixed(digits)}）`, '下降', '明显下降'];
    return {
      fill: withExcluded(row => diffColor(deltaOf(row), edges)),
      legend: {
        title: `较${spaced(comparison.label)}变化（${indicator.unit === '%' ? '百分点' : indicator.unit}）`,
        entries: [
          ...DIFF_COLORS.toReversed().map((color, index): LegendEntry => ({ color, text: labels[index] ?? '', shape: 'block' })),
          ...tail
        ],
        note: same ? '区县值与对比版本相同（变化只在汇总权重上）' : null
      }
    };
  }
  const breaks = valueBreaks(calculator, conditions, indicatorId);
  const ranges = [`< ${breaks[0]}`, `${breaks[0]} – ${breaks[1]}`, `${breaks[1]} – ${breaks[2]}`, `${breaks[2]} – ${breaks[3]}`, `≥ ${breaks[3]}`];
  return {
    fill: withExcluded(row => valueColor(row.value, breaks)),
    legend: {
      title: `${year} 年 · ${indicator.short}（${indicator.unit}）`,
      entries: [
        ...VALUE_COLORS.map((color, index): LegendEntry => ({ color, text: ranges[index] ?? '', shape: 'block' })).toReversed(),
        ...tail
      ],
      note: null
    }
  };
}

/** 人工干预的预览：改成 draft 后达标状态会变的区县 */
export function previewChanges(
  calculator: Calculator,
  conditions: SimulationConditions,
  from: SimulationParams,
  draft: SimulationParams,
  indicatorId: string,
  year: number
): Set<string> {
  const before = indicatorResult(calculator.computeYear(conditions, from, year).indicators, indicatorId).rows;
  const after = new Map(
    indicatorResult(calculator.computeYear(conditions, draft, year).indicators, indicatorId).rows.map(row => [row.code, row])
  );
  return new Set(before.filter(row => after.get(row.code)?.pass !== row.pass).map(row => row.code));
}
