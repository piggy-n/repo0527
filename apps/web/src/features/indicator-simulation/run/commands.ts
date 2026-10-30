import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { type Composition, SIMULATION_YEARS } from '../compose/composition';
import { findCities, findIndicators } from '../compose/prompt';
import { scopeText } from '../flow/plan';
import { simulationIndicator } from '../model/indicators';
import {
  changedParams,
  describeParam,
  isStandard,
  paramApplies,
  type ParamKey,
  PARAM_LABELS,
  POP_CHANGE_RANGE,
  type SimulationParams
} from '../model/params';

/** 推演中对话的一句话：暂停、继续、停止，改参数或条件，或者没有可执行的意思（notes 说明原因） */
export type RunCommand =
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'stop' }
  | {
      readonly kind: 'change';
      readonly composition: Composition;
      /** 改了年度、范围或指标：从条件解析重算；只改参数时按引擎的规则保存或重算 */
      readonly conditionsChanged: boolean;
      /** 改了什么，AI 回复里逐项写出 */
      readonly said: readonly string[];
      readonly notes: readonly string[];
    }
  | { readonly kind: 'none'; readonly notes: readonly string[] };

const ADD = /加上|增加|添加|再加|加入|也看|还要|补充/;
const REMOVE = /去掉|删除|删掉|移除|不看|不要|排除|拿掉/;
const ONLY = /只看|只推演|只计算|只要|换成|改成|改为/;

const shortOf = (id: string) => simulationIndicator(id).short;
const sameList = (a: readonly (string | number)[], b: readonly (string | number)[]) => a.join() === b.join();

// 按动词合并：去掉、只看、加上（默认）
function merge<T>(current: readonly T[], mentioned: readonly T[], text: string, order: readonly T[]): T[] {
  if (REMOVE.test(text)) {
    return current.filter(item => !mentioned.includes(item));
  }
  if (ONLY.test(text) && !ADD.test(text)) {
    return order.filter(item => mentioned.includes(item));
  }
  return order.filter(item => current.includes(item) || mentioned.includes(item));
}

// 参数的写法：同推演指令，再加上改回标准口径、改回新规程、覆盖 ≥ 50%、人口不变
function mentionedParams(text: string): Partial<SimulationParams> {
  const patch: { -readonly [K in keyof SimulationParams]?: SimulationParams[K] } = {};
  if (/(恢复|改回|回到|按)标准口径/.test(text)) {
    Object.assign(patch, { rule: 'new', recognition: 'half', popChange: 0 });
  }
  if (text.includes('旧规程')) {
    patch.rule = 'old';
  } else if (text.includes('新规程')) {
    patch.rule = 'new';
  }
  if (text.includes('相交')) {
    patch.recognition = 'intersect';
  } else if (/(覆盖|认定).*(50%|一半)/.test(text)) {
    patch.recognition = 'half';
  }
  const pop = /人口(增加|增长|上升|提高|减少|下降|降低)(\d+)%/.exec(text);
  if (pop) {
    const stepped = Math.round(Number(pop[2]) / POP_CHANGE_RANGE.step) * POP_CHANGE_RANGE.step;
    const size = Math.min(POP_CHANGE_RANGE.max, stepped);
    patch.popChange = /减少|下降|降低/.test(pop[1] ?? '') ? -size : size;
  } else if (/人口(不变|恢复)/.test(text)) {
    patch.popChange = 0;
  }
  return patch;
}

/**
 * 理解推演中说的一句话（按规则，不接大模型）：停止；改参数（规程、认定、人口、某项指标的目标值）；
 * 加上、去掉或只看某些城市、指标、年度；没有改动时才认暂停和继续。用不上的参数、清空的条件写进 notes，不改
 */
export function interpretCommand(input: string, current: Composition): RunCommand {
  const text = input.replace(/\s+/g, '');
  if (/停止|终止|结束推演|取消推演|结束计算|取消计算|不推了|不算了|重新编排|调整条件/.test(text)) {
    return { kind: 'stop' };
  }
  const { conditions, params } = current;
  const notes: string[] = [];

  // 目标值："公园绿地覆盖率目标 75"
  let rest = text;
  let targets = params.targets;
  const target = /^(.*?)目标值?(?:改成|改为|设为|调到|调整为|定为|为|到)?(\d+(?:\.\d+)?)/.exec(text);
  if (target) {
    const id = findIndicators(target[1] ?? '').find(item => conditions.indicatorIds.includes(item));
    if (id === undefined) {
      notes.push('没找到要改目标值的指标，指标要先在计算条件里');
    } else {
      targets = { ...params.targets, [id]: Number(target[2]) };
    }
    rest = text.replace(target[0], '');
  }

  // 条件：城市、指标、年度
  const verb = ADD.test(rest) || REMOVE.test(rest) || ONLY.test(rest);
  const cities = /人口/.test(rest) ? [] : findCities(rest);
  const indicators = findIndicators(rest);
  const years = [...new Set([...rest.matchAll(/20\d{2}/g)].map(match => Number(match[0])))].filter(year =>
    SIMULATION_YEARS.includes(year)
  );
  const cityCodes =
    cities.length > 0
      ? merge(conditions.cityCodes, cities, rest, JIANGSU_CITIES.map(city => city.code))
      : conditions.cityCodes;
  const indicatorIds =
    indicators.length > 0 && verb
      ? REMOVE.test(rest)
        ? conditions.indicatorIds.filter(id => !indicators.includes(id))
        : ONLY.test(rest) && !ADD.test(rest)
          ? indicators
          : [...conditions.indicatorIds, ...indicators.filter(id => !conditions.indicatorIds.includes(id))]
      : conditions.indicatorIds;
  const yearList = years.length > 0 ? merge(conditions.years, years, rest, SIMULATION_YEARS) : conditions.years;
  if (cityCodes.length === 0 || indicatorIds.length === 0 || yearList.length === 0) {
    return { kind: 'none', notes: [...notes, '年份、范围和指标都至少要留一项'] };
  }

  // 参数：只改用得上的
  const patch = mentionedParams(rest);
  const next: SimulationParams = { ...params, ...patch, targets };
  for (const key of ['rule', 'recognition', 'popChange'] as const) {
    if (key in patch && next[key] !== params[key] && !indicatorIds.some(id => paramApplies(key, id))) {
      notes.push(`当前指标用不上${PARAM_LABELS[key]}`);
      Object.assign(next, { [key]: params[key] });
    }
  }

  const said: string[] = [];
  if (!sameList(cityCodes, conditions.cityCodes)) {
    said.push(`范围改为${scopeText(cityCodes)}`);
  }
  const added = indicatorIds.filter(id => !conditions.indicatorIds.includes(id));
  const removed = conditions.indicatorIds.filter(id => !indicatorIds.includes(id));
  if (added.length > 0) {
    said.push(`加上${added.map(shortOf).join('、')}`);
  }
  if (removed.length > 0) {
    said.push(`去掉${removed.map(shortOf).join('、')}`);
  }
  const conditionsChanged =
    !sameList(cityCodes, conditions.cityCodes) ||
    !sameList(indicatorIds, conditions.indicatorIds) ||
    !sameList(yearList, conditions.years);
  if (!sameList(yearList, conditions.years)) {
    said.push(`年度改为 ${yearList.toSorted((a, b) => a - b).join('、')} 年`);
  }
  const nextConditions = { years: yearList, cityCodes, indicatorIds };
  for (const key of changedParams(params, next)) {
    if (key === 'targets') {
      const changed = indicatorIds.filter(id => next.targets[id] !== params.targets[id]);
      said.push(changed.map(id => `${shortOf(id)}目标改为 ${next.targets[id]}`).join('、'));
      continue;
    }
    const used = indicatorIds.filter(id => paramApplies(key, id));
    const kindText = isStandard(key, next) ? '（标准口径）' : '（自定义口径）';
    said.push(
      `${PARAM_LABELS[key]}改为「${describeParam(key, next, nextConditions)}」${kindText}，影响${used.map(shortOf).join('、')}`
    );
  }

  if (said.length > 0) {
    return {
      kind: 'change',
      composition: { conditions: nextConditions, params: next },
      conditionsChanged,
      said,
      notes
    };
  }
  if (notes.length === 0 && /暂停|停一下|等一下|先停/.test(text)) {
    return { kind: 'pause' };
  }
  if (notes.length === 0 && /继续|恢复推演|恢复计算|接着/.test(text)) {
    return { kind: 'resume' };
  }
  return { kind: 'none', notes };
}

/** 对话栏上方的快捷说法：按当前的条件、参数和推演状态给几条 */
export function commandSuggestions(
  { conditions, params }: Composition,
  phase: 'running' | 'paused' | 'done'
): string[] {
  const { indicatorIds, cityCodes } = conditions;
  const uses = (key: ParamKey) => indicatorIds.some(id => paramApplies(key, id));
  const list: string[] = [];
  if (phase !== 'done') {
    list.push(phase === 'paused' ? '继续' : '暂停');
  }
  if (uses('recognition')) {
    list.push(params.recognition === 'intersect' ? '覆盖认定改回 50%' : '改成相交即算');
  }
  if (uses('rule')) {
    list.push(params.rule === 'old' ? '改回新规程' : '按旧规程计算');
  }
  if (uses('popChange')) {
    list.push(params.popChange === 0 ? '常住人口增加 10%' : '人口不变');
  }
  const other = JIANGSU_CITIES.find(city => !cityCodes.includes(city.code));
  if (other && cityCodes.length < 4) {
    list.push(`加上${other.name}`);
  }
  const last = indicatorIds.at(-1);
  if (indicatorIds.length > 1 && last !== undefined) {
    list.push(`去掉${shortOf(last)}`);
  } else if (!indicatorIds.includes('A-39')) {
    list.push('加上人均公园绿地');
  }
  list.push(phase === 'done' ? '调整条件' : '停止计算');
  return list;
}
