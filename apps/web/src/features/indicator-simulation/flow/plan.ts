import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { STEP_GROUPS, type StepGroupId, type StepId, STEPS } from '../engine/steps';
import { formatDelta, formatValue } from '../format';
import { indicatorResult } from '../model/analysis';
import type { Calculator } from '../model/calculator';
import { facilityLayoutOf } from '../model/facilities';
import { type SimulationIndicator, simulationIndicator, walkMeters } from '../model/indicators';
import {
  defaultParams,
  describeParam,
  isScenario,
  isStandard,
  paramApplies,
  PARAM_LABELS,
  signedPercent,
  type SimulationConditions,
  type SimulationParams
} from '../model/params';
import { em, type Rich, rich } from '../run/narrative';

/** 流程图的节点：属于引擎的某一步，由那一步的进度点亮 */
export interface FlowNode {
  readonly key: string;
  readonly step: StepId;
  /** 第几列：条件解析 0，数据准备 1 … 结论生成 5 */
  readonly column: number;
  readonly label: string;
  readonly title: string;
  readonly detail: string;
  /** root 是树根（条件解析），standard 是模拟情景的标准口径对照 */
  readonly kind: 'root' | 'node' | 'standard';
  /** 这个节点按模拟情景计算 */
  readonly scenario: boolean;
  readonly x: number;
  readonly y: number;
}

/** AI 推理的一句：属于引擎的某一步，可以点亮一个节点 */
export interface FlowLine {
  readonly step: StepId;
  readonly node: string | null;
  readonly text: Rich;
}

/** 一轮推演的流程图：节点、连线、每步的推理文字和摘要，以及画布的尺寸 */
export interface FlowPlan {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly (readonly [from: string, to: string])[];
  readonly lines: readonly FlowLine[];
  readonly summaries: Readonly<Record<StepGroupId, string>>;
  readonly width: number;
  readonly height: number;
}

export interface FlowInput {
  readonly calculator: Calculator;
  readonly conditions: SimulationConditions;
  readonly params: SimulationParams;
}

/** 节点的尺寸与排布（像素），组件按它画 */
export const FLOW_LAYOUT = {
  nodeWidth: 168,
  nodeHeight: 74,
  columnGap: 44,
  rowHeight: 88,
  padX: 32,
  padY: 52,
  // 两个指标分支之间多空的行数
  branchGap: 0.35
} as const;

/** 每列的标题：引擎步骤分组的名称 */
export const FLOW_COLUMNS: readonly string[] = STEP_GROUPS.map(group => group.name);

const COLUMN: Readonly<Record<StepGroupId, number>> = Object.fromEntries(
  STEP_GROUPS.map((group, index) => [group.id, index])
) as Record<StepGroupId, number>;

// 站点的步行时间由 5 分钟改为 15 分钟的两项：服务中心一直是 15 分钟（Excel 的备注）
const STATIONS: Readonly<Record<string, readonly [center: string, station: string]>> = {
  'A-31': ['社区卫生服务中心', '卫生服务站'],
  'A-35': ['文化活动中心', '文化活动站']
};
// Excel 写明"缓冲区 + 路网服务区"取并集的一项
const UNION_IDS: ReadonlySet<string> = new Set(['B-65']);

const cityName = (code: string): string => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code;
const meters = (value: number): string => (value >= 1000 ? `${value / 1000} 公里` : `${value} 米`);
const formatNumber = (value: number, digits = 0): string =>
  value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 范围的说明：一两个市写全名，全省写"全省"，更多时写"南京市等 3 个市" */
export function scopeText(cityCodes: readonly string[]): string {
  if (cityCodes.length === JIANGSU_CITIES.length) {
    return '全省';
  }
  const [first = ''] = cityCodes;
  return cityCodes.length <= 2 ? cityCodes.map(cityName).join('、') : `${cityName(first)}等 ${cityCodes.length} 个市`;
}

/** 一项覆盖率指标要生成的服务范围：设施、范围的说明、距离；模拟情景的站点标出来 */
interface ServiceArea {
  readonly facility: string;
  readonly reach: string;
  readonly meters: number;
  readonly scenario: boolean;
  readonly union: boolean;
}

function serviceAreas(indicator: SimulationIndicator, params: SimulationParams): ServiceArea[] {
  if (indicator.model !== 'coverage') {
    return [];
  }
  const { reach } = indicator;
  const stations = STATIONS[indicator.id];
  if (stations && reach.kind === 'walk') {
    const old = indicator.ruleChange && params.rule === 'old';
    const [center, station] = stations;
    return [
      {
        facility: center,
        reach: `步行 ${reach.minutes} 分钟`,
        meters: walkMeters(reach.minutes),
        scenario: false,
        union: false
      },
      {
        facility: station,
        reach: old ? '步行 5 分钟（旧规程）' : `步行 ${reach.minutes} 分钟`,
        meters: old ? walkMeters(5) : walkMeters(reach.minutes),
        scenario: old,
        union: false
      }
    ];
  }
  switch (reach.kind) {
    case 'walk': {
      const distance = walkMeters(reach.minutes);
      if (UNION_IDS.has(indicator.id)) {
        return [
          { facility: indicator.facility, reach: '缓冲区', meters: distance, scenario: false, union: false },
          { facility: '路网服务区', reach: `步行 ${reach.minutes} 分钟`, meters: distance, scenario: false, union: true }
        ];
      }
      return [
        {
          facility: indicator.facility,
          reach: `步行 ${reach.minutes} 分钟`,
          meters: distance,
          scenario: false,
          union: false
        }
      ];
    }
    case 'drive':
      return [
        {
          facility: indicator.facility,
          reach: `车行 ${reach.minutes} 分钟`,
          meters: reach.meters,
          scenario: false,
          union: false
        }
      ];
    case 'radius':
      break;
  }
  return [{ facility: indicator.facility, reach: '缓冲区', meters: reach.meters, scenario: false, union: false }];
}

const recognitionText = (params: SimulationParams): string =>
  params.recognition === 'intersect' ? '相交即算' : '覆盖 ≥ 50%';

interface Draft {
  readonly key: string;
  readonly step: StepId;
  readonly label: string;
  readonly title: string;
  readonly detail: string;
  readonly kind?: FlowNode['kind'];
  readonly scenario?: boolean;
}

/**
 * 一轮推演的流程图：条件解析 → 人口、设施、用地三路数据 → 数据核查 → 按指标分支（服务范围 → 指标计算〔模拟情景另有标准口径对照〕）
 * → 结论生成。节点、推理文字里的数字都来自同一份计算，同样的输入得到同样的图；不按目标值评价（2026-10-30）
 */
export function flowPlan({ calculator, conditions, params }: FlowInput): FlowPlan {
  const { years, cityCodes, indicatorIds } = conditions;
  const year = Math.max(...years);
  const yearsText = years.toSorted((a, b) => a - b).join('、');
  const scope = scopeText(cityCodes);
  const indicators = indicatorIds.map(simulationIndicator);
  const scenarioIds = indicatorIds.filter(id => isScenario(params, id));
  const coverage = indicators.filter(indicator => indicator.model === 'coverage');
  const perCapita = indicators.filter(indicator => indicator.model === 'perCapita');
  const districts = calculator.atlas.inCities(cityCodes);
  const census = districts.reduce((sum, district) => sum + calculator.districtPopulation(district), 0);
  const residential = districts.reduce((sum, district) => sum + calculator.residentialLand(district), 0);
  const current = calculator.computeYear(conditions, params, year).indicators;
  const standard =
    scenarioIds.length === 0
      ? current
      : calculator.computeYear({ ...conditions, indicatorIds: scenarioIds }, defaultParams(), year).indicators;
  // 标准口径的值：模拟情景的指标另算了一遍，其余就是这次的值
  const standardOf = (id: string) => indicatorResult(scenarioIds.includes(id) ? standard : current, id);
  const layout = facilityLayoutOf(calculator);
  const facilityCounts = coverage.map(indicator => ({
    facility: indicator.facility,
    total: layout.total(conditions, indicator.id, year)
  }));
  const facilityTotal = facilityCounts.reduce((sum, item) => sum + item.total, 0);

  const drafts: Draft[] = [];
  const edges: [string, string][] = [];
  const lines: FlowLine[] = [];
  const node = (draft: Draft) => drafts.push(draft);
  const link = (from: string, to: string) => edges.push([from, to]);
  const say = (step: StepId, text: Rich, key: string | null = null) => lines.push({ step, node: key, text });

  // 条件解析：一个节点，整步都在思考
  node({
    key: 'parse',
    step: 'parse',
    label: '条件解析',
    title: `${scope} · ${yearsText} 年`,
    detail: `${indicatorIds.length} 项指标 · ${scenarioIds.length > 0 ? '含自定义口径' : '标准口径'}`,
    kind: 'root'
  });
  say('parse', rich`理解指令：计算 ${em(`${yearsText} 年`)}${scope}的 ${em(`${indicatorIds.length} 项`)}指标。`, 'parse');
  const area = coverage.filter(indicator => indicator.base === 'area').length;
  const kinds = [
    coverage.length - area > 0 ? `住宅用地覆盖率 ${coverage.length - area} 项` : '',
    area > 0 ? `城区面积覆盖率 ${area} 项` : '',
    perCapita.length > 0 ? `人均 ${perCapita.length} 项` : ''
  ].filter(Boolean);
  say('parse', rich`按计算方法分类：${kinds.join('、')}；计算参数按指标类型分别适用。`, 'parse');
  const changed = (['rule', 'recognition', 'popChange'] as const).filter(
    key => !isStandard(key, params) && indicatorIds.some(id => paramApplies(key, id))
  );
  if (changed.length > 0) {
    const values = changed.map(key => `${PARAM_LABELS[key]}按「${describeParam(key, params)}」`).join('，');
    const scenarioNames = scenarioIds.map(id => simulationIndicator(id).short).join('、');
    say('parse', rich`${values}，当前使用${em('自定义口径')}计算；${scenarioNames}另算一支标准口径作对照。`, 'parse');
  } else {
    say('parse', rich`参数都按${em('标准口径')}计算。`, 'parse');
  }
  say('parse', rich`规划路线：数据分三路并行准备，核查后按指标分成 ${em(`${indicatorIds.length} 支`)}，最后汇总成结论。`, 'parse');

  // 数据准备：三路并行
  const shownCities = cityCodes.slice(0, 3).map(code => {
    const total = calculator.atlas
      .inCities([code])
      .reduce((sum, district) => sum + calculator.districtPopulation(district), 0);
    return `${cityName(code)} ${total.toFixed(1)} 万人`;
  });
  const popChanged = params.popChange !== 0 && perCapita.length > 0;
  node({ key: 'pop', step: 'pop', label: '人口数据', title: '七普常住人口', detail: `${formatNumber(census, 1)} 万人` });
  const moreCities = cityCodes.length > 3 ? ` 等 ${cityCodes.length} 市` : '';
  const popAdjusted = popChanged ? `，人均类按 ${signedPercent(params.popChange)} 调整` : '';
  say(
    'pop',
    rich`读取七普常住人口：${shownCities.join('、')}${moreCities}，合计 ${em(`${formatNumber(census, 1)} 万人`)}${popAdjusted}。`,
    'pop'
  );
  const facilityTypes = [
    ...new Set(
      coverage.flatMap(indicator =>
        serviceAreas(indicator, params)
          .filter(item => !item.union)
          .map(item => item.facility)
      )
    )
  ];
  node({
    key: 'poi',
    step: 'poi',
    label: '设施数据',
    title: coverage.length > 0 ? `${facilityTypes.length} 类设施点` : '不需要设施点',
    detail: coverage.length > 0 ? `${formatNumber(facilityTotal)} 处` : '人均类只用用地'
  });
  const moreFacilities = facilityTypes.length > 4 ? ` 等 ${facilityTypes.length} 类` : '';
  say(
    'poi',
    coverage.length > 0
      ? rich`载入设施点：${facilityTypes.slice(0, 4).join('、')}${moreFacilities}，共 ${em(`${formatNumber(facilityTotal)} 处`)}。`
      : rich`所选指标不需要设施点，这一路跳过。`,
    'poi'
  );
  node({
    key: 'land',
    step: 'land',
    label: '用地数据',
    title: '住宅用地与专项用地',
    detail: `${formatNumber(residential)} 平方千米`
  });
  const extraLand = perCapita.length > 0 ? `，以及${perCapita.map(indicator => indicator.facility).join('、')}` : '';
  say('land', rich`载入用地：住宅用地 ${em(`${formatNumber(residential)} 平方千米`)}${extraLand}。`, 'land');
  for (const key of ['pop', 'poi', 'land']) {
    link('parse', key);
    link(key, 'qc');
  }

  // 数据核查
  node({ key: 'qc', step: 'qc', label: '数据核查', title: `${districts.length} 个区县`, detail: '数据完整' });
  say('qc', rich`核对 ${em(`${districts.length} 个区县`)}的人口、设施和用地：字段齐全，设施坐标都落在区县范围内。`, 'qc');
  say('qc', rich`${year} 年没有缺失数据，可以开始空间分析。`, 'qc');

  // 按指标分支：服务范围（人均类是用地汇总）→ 指标计算（模拟情景另有标准口径对照）
  const blocks: { id: string; saKeys: string[]; calcKeys: string[] }[] = [];
  for (const indicator of indicators) {
    const { id, short } = indicator;
    const data = indicatorResult(current, id);
    const scenario = scenarioIds.includes(id);
    const saKeys: string[] = [];
    if (indicator.model === 'coverage') {
      serviceAreas(indicator, params).forEach((item, index) => {
        const key = `sa:${id}:${index}`;
        saKeys.push(key);
        node({
          key,
          step: 'spatial',
          label: short,
          title: item.union ? '路网服务区 · 取并集' : item.facility,
          detail: `${item.reach} · ${meters(item.meters)}`,
          scenario: item.scenario
        });
        say(
          'spatial',
          item.union
            ? rich`再叠加${item.reach}的路网服务区，和缓冲区${em('取并集')}。`
            : rich`${short}：${item.facility}按${item.reach}生成服务范围，半径 ${em(meters(item.meters))}。`,
          key
        );
      });
    } else {
      const key = `sa:${id}:land`;
      saKeys.push(key);
      // 用地面积不随人口变化：标准口径的人均值 × 七普人口（万人）= 公顷
      const land = standardOf(id).value * census;
      node({
        key,
        step: 'spatial',
        label: short,
        title: `${indicator.facility}汇总`,
        detail: `${formatNumber(land)} 公顷`
      });
      say('spatial', rich`${short}：${indicator.facility}汇总到区县，共 ${em(`${formatNumber(land)} 公顷`)}。`, key);
    }

    const calcKey = `calc:${id}`;
    const calcKeys = [calcKey];
    const value = formatValue(data.value, indicator);
    const how =
      indicator.model === 'perCapita'
        ? `÷ 七普人口${params.popChange !== 0 ? `（${signedPercent(params.popChange)}）` : ''}`
        : indicator.base === 'area'
          ? '叠加城区面积 · 相交即算'
          : `叠加住宅用地 · ${recognitionText(params)}`;
    node({ key: calcKey, step: 'compute', label: short, title: value, detail: how, scenario });
    const where = `${years.length > 1 ? `${year} 年` : ''}${scope}`;
    const popNote = params.popChange !== 0 ? `（${signedPercent(params.popChange)}）` : '';
    say(
      'compute',
      indicator.model === 'perCapita'
        ? rich`${short}：${indicator.facility}面积除以七普人口${popNote}，${where}为 ${em(value)}。`
        : indicator.base === 'area'
          ? rich`${short}：服务范围叠加城区面积，相交即算，${where} ${em(value)}。`
          : rich`${short}：服务范围叠加住宅用地，${recognitionText(params)}的图斑算覆盖，${where} ${em(value)}。`,
      calcKey
    );
    const base = standardOf(id);
    if (scenario) {
      const stdKey = `calc:${id}:std`;
      calcKeys.push(stdKey);
      node({
        key: stdKey,
        step: 'compute',
        label: '对照 · 标准口径',
        title: formatValue(base.value, indicator),
        detail: `${short} · 标准规则`,
        kind: 'standard'
      });
      const delta = data.value - base.value;
      const deltaText = em(formatDelta(Math.abs(delta), indicator).replace(/^\+/, ''));
      say(
        'compute',
        rich`对照标准口径为 ${em(formatValue(base.value, indicator))}，自定义口径${delta >= 0 ? '高' : '低'}出 ${deltaText}。`,
        stdKey
      );
    }
    for (const sa of saKeys) {
      link('qc', sa);
      for (const calc of calcKeys) {
        link(sa, calc);
      }
    }
    for (const calc of calcKeys) {
      link(calc, 'report');
    }
    blocks.push({ id, saKeys, calcKeys });
  }

  // 结论生成：按条件里的顺序汇总各项指标的值
  node({
    key: 'report',
    step: 'report',
    label: '结论生成',
    title: `${indicatorIds.length} 项指标`,
    detail: `${scope} · ${year} 年`
  });
  const values = indicatorIds
    .slice(0, 4)
    .map(id => {
      const indicator = simulationIndicator(id);
      return `${indicator.short} ${formatValue(indicatorResult(current, id).value, indicator)}`;
    })
    .join('，');
  say('report', rich`汇总 ${em(`${indicatorIds.length} 支`)}：${values}${indicatorIds.length > 4 ? ' 等' : ''}。`, 'report');
  if (scenarioIds.length > 0) {
    const effects = scenarioIds.map(id => {
      const indicator = simulationIndicator(id);
      return `${indicator.short}${formatDelta(indicatorResult(current, id).value - standardOf(id).value, indicator)}`;
    });
    say('report', rich`自定义口径让${effects.join('、')}，结论按自定义口径给出，标准口径的值一并保留。`, 'report');
  }
  say('report', rich`计算完成，点下方的"查看结果"在地图上查看各区县。`, 'report');

  // 位置：分支按块从上往下排，块内居中；不分支的列在整棵树的中间
  const { nodeWidth, columnGap, rowHeight, padX, padY, branchGap } = FLOW_LAYOUT;
  const slots = new Map<string, number>();
  let row = 0;
  for (const block of blocks) {
    const rows = Math.max(block.saKeys.length, block.calcKeys.length);
    const center = row + (rows - 1) / 2;
    block.saKeys.forEach((key, index) => slots.set(key, center - (block.saKeys.length - 1) / 2 + index));
    block.calcKeys.forEach((key, index) => slots.set(key, center - (block.calcKeys.length - 1) / 2 + index));
    row += rows + branchGap;
  }
  const totalRows = Math.max(3, row - branchGap);
  const middle = (totalRows - 1) / 2;
  for (const key of ['parse', 'qc', 'report']) {
    slots.set(key, middle);
  }
  ['pop', 'poi', 'land'].forEach((key, index) => slots.set(key, middle - 1 + index));

  const nodes = drafts.map((draft): FlowNode => {
    const group = STEPS.find(step => step.id === draft.step)?.group ?? 'parse';
    const column = COLUMN[group];
    return {
      key: draft.key,
      step: draft.step,
      label: draft.label,
      title: draft.title,
      detail: draft.detail,
      kind: draft.kind ?? 'node',
      scenario: draft.scenario ?? false,
      column,
      x: padX + column * (nodeWidth + columnGap),
      y: padY + (slots.get(draft.key) ?? middle) * rowHeight
    };
  });

  const saCount = nodes.filter(item => item.step === 'spatial').length;
  const summaries: Record<StepGroupId, string> = {
    parse: `${yearsText} 年 · ${scope} · ${indicatorIds.length} 项${scenarioIds.length > 0 ? ' · 自定义口径' : ''}`,
    prep: '人口、设施、用地 3 路数据已就绪',
    qc: `${districts.length} 个区县 · 数据完整`,
    spatial: `${saCount} 个分析分支`,
    compute: `${indicatorIds.length} 项指标已计算${scenarioIds.length > 0 ? `，${scenarioIds.length} 项有对照` : ''}`,
    report: '结论已生成'
  };

  return {
    nodes,
    edges,
    lines,
    summaries,
    width: padX * 2 + STEP_GROUPS.length * nodeWidth + (STEP_GROUPS.length - 1) * columnGap,
    height: padY + totalRows * rowHeight + 8
  };
}

