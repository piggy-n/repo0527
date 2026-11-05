import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { type Composition, rememberedScopes, SIMULATION_YEARS, withScope } from '../compose/composition';
import { type ConditionConflict, paramConflicts, saidPopChanges, saidRecognition, saidRule, scopeConflict, withoutPop } from '../compose/conflicts';
import { AREA_WORDS, findCities, findIndicators, saidScope } from '../compose/prompt';
import { applyWalk, findWalk } from '../compose/walk-prompt';
import { scopeText } from '../flow/plan';
import { simulationIndicator, standardWalkMinutes, walkOptions } from '../model/indicators';
import { areaLabel, areaScope, citiesScope, scopeCityCodes, type SimulationScope } from '../model/scope';
import {
  changedParams,
  defaultParams,
  describeParam,
  isStandard,
  keepWalkMinutes,
  paramApplies,
  type ParamKey,
  PARAM_LABELS,
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
  /** 一句话里互相矛盾：不改，问用哪一个（ADR 0129） */
  | { readonly kind: 'conflict'; readonly conflicts: readonly ConditionConflict[] }
  | { readonly kind: 'none'; readonly notes: readonly string[] };

const ADD = /加上|增加|添加|再加|加入|也看|还要|补充/;
const REMOVE = /去掉|删除|删掉|移除|不看|不要|排除|拿掉/;
const ONLY = /只看|只推演|只计算|只要|换成|改成|改为/;
// 说到这些动词时指标本身也要变：步行时长的说法不从句子里去掉，"加上社区小学步行 20 分钟"仍然加上社区小学
const KEEP_INDICATOR = /只看|只推演|只计算|只要|换成/;
const WALK_RESET = /步行(时长|时间)?(改回|恢复|回到)/;
const REMOVE_SCOPE = /(去掉|删除|删掉|移除|不要|清空|取消)(监测|计算|自定义|这个|该|当前)*范围/;

const shortOf = (id: string) => simulationIndicator(id).short;
const sameList = (a: readonly (string | number)[], b: readonly (string | number)[]) => a.join() === b.join();

function sameScope(a: SimulationScope, b: SimulationScope): boolean {
  if (a.kind === 'cities' && b.kind === 'cities') {
    return sameList(a.cityCodes, b.cityCodes);
  }
  return a.kind === 'area' && b.kind === 'area' && a.area === b.area;
}

// 说到的范围：移除、自定义范围、城市（在自定义范围下说城市，改为行政区划，"加上""去掉"以范围涉及的市为基础）
function nextScope(text: string, current: Composition, notes: string[]): SimulationScope {
  const { scope } = current.conditions;
  const { area } = rememberedScopes(current);
  if (REMOVE_SCOPE.test(text)) {
    if (scope.kind === 'cities' && text.includes('自定义')) {
      notes.push('当前用的是行政区划，没有自定义范围可移除');
      return scope;
    }
    return scope.kind === 'area' ? areaScope(null) : citiesScope([]);
  }
  const said = saidScope(text, citiesIn(text));
  if (said.kind === 'area') {
    if (area) {
      return areaScope(area);
    }
    // 正等着补充范围：切到自定义范围，条件库给出上传和绘制；已有范围时不丢掉它
    if (scopeCityCodes(scope).length === 0) {
      return areaScope(null);
    }
    notes.push('还没有自定义范围，可以点"上传范围"或说"绘制范围"');
    return scope;
  }
  if (said.kind !== 'cities') {
    return scope;
  }
  return citiesScope(merge(scopeCityCodes(scope), said.cityCodes, text, JIANGSU_CITIES.map(city => city.code)));
}

// 对话里说人口时不认城市
const citiesIn = (text: string) => (/人口/.test(text) ? [] : findCities(text));

// 一项条件原来有、这句话之后没了
const emptied = (before: readonly unknown[], after: readonly unknown[]) => before.length > 0 && after.length === 0;

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
    Object.assign(patch, { rule: 'new', recognition: 'half', popChange: 0, walkMinutes: defaultParams().walkMinutes });
  }
  const rule = saidRule(text);
  if (rule === 'old' || rule === 'new') {
    patch.rule = rule;
  }
  const recognition = saidRecognition(text);
  if (recognition === 'intersect' || recognition === 'half') {
    patch.recognition = recognition;
  }
  const [pop] = saidPopChanges(text);
  if (pop !== undefined) {
    patch.popChange = pop;
  } else if (/人口(不变|恢复)/.test(text)) {
    patch.popChange = 0;
  }
  return patch;
}

/**
 * 理解推演中说的一句话（按规则，不接大模型）：停止；改参数（规程、认定、人口、步行时长）；
 * 加上、去掉或只看某些城市、指标、年度；新增、替换或移除监测范围；没有改动时才认暂停和继续。
 * 用不上的参数、清空的年份和指标写进 notes，不改；一句话里互相矛盾时问用哪一个。范围可以移除，结果里条件就不全了（ADR 0129）
 */
export function interpretCommand(input: string, current: Composition): RunCommand {
  const text = input.replace(/\s+/g, '');
  if (/停止|终止|结束推演|取消推演|结束计算|取消计算|不推了|不算了|重新编排|调整条件/.test(text)) {
    return { kind: 'stop' };
  }
  // 不按目标值评价（2026-10-30）：说到目标值时不改条件，免得"……目标改成 13"被当成"只看"
  if (text.includes('目标')) {
    return { kind: 'none', notes: ['计算结果只给出各项指标的值，不设置目标值'] };
  }
  const { conditions, params } = current;
  const notes: string[] = [];
  const named = saidScope(text, citiesIn(text));
  if (named.kind === 'both') {
    return { kind: 'conflict', conflicts: [scopeConflict(named.cityCodes, rememberedScopes(current).area !== null)] };
  }
  // 单纯改步行时长时，句子里的指标和"改成"不是在改所选的指标
  const walk = findWalk(text);
  const keepsIndicator = ADD.test(text) || REMOVE.test(text) || KEEP_INDICATOR.test(text);
  const rest = walk && !keepsIndicator ? walk.rest : text;

  // 条件：范围、指标、年度
  const verb = ADD.test(rest) || REMOVE.test(rest) || ONLY.test(rest);
  const scope = nextScope(rest, current, notes);
  const indicators = findIndicators(rest);
  const saidYears = [...new Set([...rest.matchAll(/20\d{2}/g)].map(match => Number(match[0])))];
  const years = saidYears.filter(year => SIMULATION_YEARS.includes(year));
  const unavailable = saidYears.filter(year => !SIMULATION_YEARS.includes(year));
  if (unavailable.length > 0) {
    notes.push(`没有 ${unavailable.join('、')} 年的数据，可选 ${SIMULATION_YEARS.at(-1)}～${SIMULATION_YEARS[0]} 年`);
  }
  const indicatorIds =
    indicators.length > 0 && verb
      ? REMOVE.test(rest)
        ? conditions.indicatorIds.filter(id => !indicators.includes(id))
        : ONLY.test(rest) && !ADD.test(rest)
          ? indicators
          : [...conditions.indicatorIds, ...indicators.filter(id => !conditions.indicatorIds.includes(id))]
      : conditions.indicatorIds;
  const yearList = years.length > 0 ? merge(conditions.years, years, rest, SIMULATION_YEARS) : conditions.years;
  if (emptied(conditions.indicatorIds, indicatorIds) || emptied(conditions.years, yearList)) {
    return { kind: 'none', notes: [...notes, '年份和指标均需至少保留一项'] };
  }
  const contradictions = paramConflicts(rest).filter(conflict => indicatorIds.some(id => paramApplies(conflict.key, id)));
  if (contradictions.length > 0) {
    return { kind: 'conflict', conflicts: contradictions };
  }

  // 参数：只改用得上的
  const patch = mentionedParams(rest);
  let next: SimulationParams = { ...params, ...patch };
  for (const key of ['rule', 'recognition', 'popChange'] as const) {
    if (key in patch && next[key] !== params[key] && !indicatorIds.some(id => paramApplies(key, id))) {
      notes.push(`所选指标不适用${PARAM_LABELS[key]}`);
      Object.assign(next, { [key]: params[key] });
    }
  }
  if (WALK_RESET.test(rest)) {
    next = { ...next, walkMinutes: defaultParams().walkMinutes };
  } else if (walk) {
    const { params: walked, applied, snapped } = applyWalk(next, walk, indicatorIds);
    next = walked;
    if (applied === 0) {
      notes.push(`所选指标不适用${PARAM_LABELS.walk}`);
    } else if (snapped) {
      notes.push(`${PARAM_LABELS.walk}按 5 分钟一档，最长为标准时长的 3 倍且不超过 30 分钟，已取最接近的一档`);
    }
  }
  next = keepWalkMinutes(next, indicatorIds);

  const said: string[] = [];
  const scopeChanged = !sameScope(scope, conditions.scope);
  if (scopeChanged) {
    const { area } = rememberedScopes(current);
    if (scopeCityCodes(scope).length > 0) {
      // 从自定义范围改为行政区划时说明范围还在
      const kept = scope.kind === 'cities' && area ? `（${areaLabel(area)}仍保留，说"改回自定义范围"可以切回）` : '';
      said.push(`范围改为${scopeText(scope)}${kept}`);
    } else if (scope.kind === 'area' && conditions.scope.kind === 'cities') {
      said.push('监测范围改用自定义范围');
    } else {
      said.push(`已移除${scopeText(conditions.scope)}`);
    }
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
    scopeChanged || !sameList(indicatorIds, conditions.indicatorIds) || !sameList(yearList, conditions.years);
  if (!sameList(yearList, conditions.years)) {
    said.push(`年度改为 ${yearList.toSorted((a, b) => a - b).join('、')} 年`);
  }
  const nextConditions = { years: yearList, scope: conditions.scope, indicatorIds };
  for (const key of changedParams(params, next)) {
    // 步行时长只写改了的指标；其余参数写所有用得上的
    const used = indicatorIds.filter(id =>
      key === 'walk' ? params.walkMinutes[id] !== next.walkMinutes[id] : paramApplies(key, id)
    );
    const kindText = isStandard(key, next) ? '（标准口径）' : '（自定义口径）';
    said.push(
      `${PARAM_LABELS[key]}改为「${describeParam(key, next)}」${kindText}，影响${used.map(shortOf).join('、')}`
    );
  }

  if (said.length > 0) {
    return {
      kind: 'change',
      composition: withScope({ ...current, conditions: nextConditions, params: next }, scope),
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

// 步行时长的快捷说法：都是标准时长时建议改第一项，改过时建议改回
function walkSuggestion({ conditions, params }: Composition): string {
  if (!isStandard('walk', params)) {
    return '步行时长改回标准';
  }
  const indicator = conditions.indicatorIds.map(simulationIndicator).find(item => standardWalkMinutes(item) !== null);
  const minutes = indicator && walkOptions(indicator).find(item => item >= 10 && item !== standardWalkMinutes(indicator));
  return indicator && minutes !== undefined
    ? `${indicator.short.replace('覆盖率', '')}改为步行 ${minutes} 分钟`
    : '步行时长改回标准';
}

/** 对话栏上方的快捷说法：按当前的条件、参数和推演状态给几条 */
export function commandSuggestions(composition: Composition, phase: 'running' | 'paused' | 'done'): string[] {
  const { conditions, params } = composition;
  const { indicatorIds, scope } = conditions;
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
  if (uses('walk')) {
    list.push(walkSuggestion(composition));
  }
  // 自定义范围下不建议加城市（会改为行政区划）；行政区划下有记下的自定义范围时建议切回
  if (scope.kind === 'cities') {
    const other = JIANGSU_CITIES.find(city => !scope.cityCodes.includes(city.code));
    if (rememberedScopes(composition).area) {
      list.push('改回自定义范围');
    } else if (other && scope.cityCodes.length < 4) {
      list.push(`加上${other.name}`);
    }
  }
  const last = indicatorIds.at(-1);
  if (indicatorIds.length > 1 && last !== undefined) {
    list.push(`去掉${shortOf(last)}`);
  } else if (!indicatorIds.includes('A-39')) {
    list.push('加上人均公园绿地');
  }
  list.push('绘制范围', '移除范围', phase === 'done' ? '调整条件' : '停止计算');
  return list;
}

/** 这句话是一条新的完整指令：说了指标，又说了年份、范围或"计算"，没有"加上、去掉、只看"这类动词 */
export function isFullInstruction(input: string): boolean {
  const text = withoutPop(input.replace(/「[^」]*」/g, '').replace(/\s+/g, ''));
  if (findIndicators(text).length === 0 || ADD.test(text) || REMOVE.test(text) || ONLY.test(text)) {
    return false;
  }
  return /计算|推演/.test(text) || /20\d{2}/.test(text) || findCities(text).length > 0 || AREA_WORDS.test(text);
}

/** 开始计算的说法 */
export const isStartWord = (input: string): boolean => /^(开始计算|开始|计算|开始吧|计算吧|算吧)$/.test(input.replace(/\s+/g, ''));

/** 要上传或绘制范围的说法：打开弹窗，不是改条件 */
export function scopeAction(input: string): 'upload' | 'draw' | null {
  const match = /^(?:请|重新)*(上传|绘制|画)(?:一个|新的|自定义|监测)*范围$/.exec(input.replace(/\s+/g, ''));
  if (!match) {
    return null;
  }
  return match[1] === '上传' ? 'upload' : 'draw';
}
