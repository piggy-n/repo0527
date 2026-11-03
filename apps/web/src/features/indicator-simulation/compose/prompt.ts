import { JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import { SIMULATION_INDICATORS, simulationIndicator } from '../model/indicators';
import {
  defaultParams,
  indicatorName,
  paramApplies,
  PARAM_LABELS,
  type ParamKey,
  POP_CHANGE_RANGE,
  type SimulationParams,
  withWalkMinutes
} from '../model/params';
import { areaLabel, areaScope, citiesScope, type ScopeArea, scopeCityCodes } from '../model/scope';
import { type Composition, emptyComposition, rememberedScopes, SIMULATION_YEARS, withScope } from './composition';
import {
  type ConditionConflict,
  type ConflictKey,
  paramConflicts,
  saidPopChanges,
  saidRecognition,
  saidRule,
  scopeConflict,
  yearsConflict
} from './conflicts';
import { applyWalk, coreName, findWalk, walkStem } from './walk-prompt';

/** 三条示例指令：每条是"推演条件 + 至多一个参数"，分别用到计算规程、覆盖认定、常住人口变化 */
export const PROMPT_EXAMPLES: readonly string[] = [
  '按卫生服务站步行 5 分钟的旧规程，计算 2025 年南京市社区卫生服务设施覆盖率',
  '按“相交即算”的覆盖认定，计算 2025 年南京市公园绿地、广场步行 5 分钟覆盖率',
  '按常住人口增加 10%，计算 2025 年南京市人均公园绿地面积'
];

/** 没写年份时按 2025 年：计算方法合集的监测年度 */
const DEFAULT_YEAR = 2025;

const ALL_CITIES = JIANGSU_CITIES.map(city => city.code);

// 指标的关键词：全称、简称、去掉服务范围和"覆盖率""面积"的核心名称（如"社区卫生服务设施"），
// 步行类还有简称的词干（如"社区卫生"，"社区卫生改为步行 10 分钟"）
function indicatorKeywords(): { readonly id: string; readonly word: string }[] {
  return SIMULATION_INDICATORS.flatMap(item => {
    const stem = walkStem(item);
    const words = [item.name, item.short, coreName(item), ...(stem === null ? [] : [stem])];
    return [...new Set(words)].map(word => ({ id: item.id, word }));
  }).toSorted((a, b) => b.word.length - a.word.length);
}

/** 句子里提到的指标：长的关键词先匹配，已经匹配的位置不再给短的用（"人均公共停车场"不会再算成"公共停车场"）；按出现的先后排 */
export function findIndicators(text: string): string[] {
  const taken: (readonly [number, number])[] = [];
  const found: { readonly id: string; readonly at: number }[] = [];
  for (const { id, word } of indicatorKeywords()) {
    let from = text.indexOf(word);
    while (from !== -1) {
      const to = from + word.length;
      if (!taken.some(([start, end]) => from < end && to > start)) {
        taken.push([from, to]);
        if (!found.some(item => item.id === id)) {
          found.push({ id, at: from });
        }
      }
      from = text.indexOf(word, to);
    }
  }
  return found.toSorted((a, b) => a.at - b.at).map(item => item.id);
}

// 参数只认这几种写法，而且只在所选指标用得上时才改，其余保持标准口径；用不上的说明原因
function findParams(text: string, indicatorIds: readonly string[], notes: string[]): SimulationParams {
  const uses = (key: 'rule' | 'recognition' | 'popChange') => indicatorIds.some(id => paramApplies(key, id));
  const standard = defaultParams();
  const notUsed = (key: ParamKey) => notes.push(`所选指标不适用${PARAM_LABELS[key]}，已按标准口径`);
  const pops = saidPopChanges(text);
  const [pop = 0] = pops;
  if (pop !== 0 && !uses('popChange')) {
    notUsed('popChange');
  }
  const rule = saidRule(text);
  if (rule === 'old' && !uses('rule')) {
    notUsed('rule');
  }
  const recognition = saidRecognition(text);
  if (recognition === 'intersect' && !uses('recognition')) {
    notUsed('recognition');
  }
  const found: SimulationParams = {
    ...standard,
    rule: rule === 'old' && uses('rule') ? 'old' : standard.rule,
    recognition: recognition === 'intersect' && uses('recognition') ? 'intersect' : standard.recognition,
    popChange: pops.length === 1 && uses('popChange') ? pop : 0
  };
  const walk = findWalk(text);
  if (!walk) {
    return found;
  }
  const { params, applied, snapped } = applyWalk(found, walk, indicatorIds);
  if (applied === 0) {
    notUsed('walk');
  } else if (snapped) {
    notes.push(`${PARAM_LABELS.walk}按 5 分钟一档，已取最接近的一档`);
  }
  return params;
}

/** 句子里提到的城市（按区划目录排序）；写了"全省""江苏"时是全部 13 个市 */
export function findCities(text: string): string[] {
  return /全省|江苏/.test(text)
    ? [...ALL_CITIES]
    : JIANGSU_CITIES.filter(city => text.includes(shortRegionName(city.name))).map(city => city.code);
}

/** 指令里说到自定义范围：用上传或绘制的范围（ADR 0121） */
export const AREA_WORDS = /自定义范围|上传的范围|绘制的范围|画的范围|这个范围|该范围/;

/** 一句话里说的范围：都没说、自定义范围、城市，或者同时说了两种（要问） */
export type SaidScope =
  | { readonly kind: 'none' | 'area' }
  | { readonly kind: 'cities' | 'both'; readonly cityCodes: readonly string[] };

const SCOPE_TARGET = /(?:改成|改为|换成|改回)(.*)$/;

/** 句子里说的范围；"把自定义范围换成南京市"说的是南京市。城市由调用方找好：对话里说人口时不认城市 */
export function saidScope(text: string, cityCodes: readonly string[] = findCities(text)): SaidScope {
  const wantsArea = AREA_WORDS.test(text);
  if (wantsArea && cityCodes.length > 0) {
    const target = SCOPE_TARGET.exec(text)?.[1] ?? '';
    if (AREA_WORDS.test(target)) {
      return { kind: 'area' };
    }
    const named = findCities(target);
    return named.length > 0 ? { kind: 'cities', cityCodes: named } : { kind: 'both', cityCodes };
  }
  if (wantsArea) {
    return { kind: 'area' };
  }
  return cityCodes.length > 0 ? { kind: 'cities', cityCodes } : { kind: 'none' };
}

const mentionedYears = (text: string): number[] => [...new Set([...text.matchAll(/20\d{2}/g)].map(match => Number(match[0])))];

// 「」里是自定义范围的名称：里面的数字、城市、指标不算条件
const plainPrompt = (input: string): string => input.replace(/「[^」]*」/g, '').replace(/\s+/g, '');

/** 正在用自定义范围时占位的示例：写出范围的名称，解析得到这个范围 */
export const areaPrompt = (area: ScopeArea): string =>
  `计算${areaLabel(area)} 2025 年社区卫生服务设施覆盖率和人均公园绿地面积`;

/** 解析好的一句指令：条件可能还不全（范围待补充）；conflicts 要用户确认，notes 只是说明 */
export interface ParsedPrompt {
  readonly ok: true;
  readonly composition: Composition;
  readonly conflicts: readonly ConditionConflict[];
  readonly notes: readonly string[];
  /** 句子没说范围，接着用页面上已有的范围 */
  readonly keptScope: boolean;
}

/** 解析的结果：认不出指标时不配置 */
export type PromptParse = ParsedPrompt | { readonly ok: false; readonly reason: 'indicator' };

/**
 * 解析一句计算指令（ADR 0129）：年份（没写按 2025，写了但都不可选时留空并追问）、范围、指标、参数。
 * 范围：说了自定义范围、城市就用；都没说时，页面上已有范围就接着用，否则留空，由调用方标为待补充。记下的两种范围带进结果
 */
export function parsePrompt(input: string, current: Composition = emptyComposition()): PromptParse {
  const text = plainPrompt(input);
  const indicatorIds = findIndicators(text);
  if (indicatorIds.length === 0) {
    return { ok: false, reason: 'indicator' };
  }
  const notes: string[] = [];
  const conflicts: ConditionConflict[] = [];
  const said = mentionedYears(text);
  const years = said.filter(year => SIMULATION_YEARS.includes(year)).toSorted((a, b) => b - a);
  const unavailable = said.filter(year => !SIMULATION_YEARS.includes(year));
  if (unavailable.length > 0 && years.length === 0) {
    conflicts.push(yearsConflict(unavailable, SIMULATION_YEARS));
  } else if (unavailable.length > 0) {
    notes.push(`没有 ${unavailable.join('、')} 年的数据，已按 ${years.join('、')} 年计算`);
  }

  const { area } = rememberedScopes(current);
  const named = saidScope(text);
  const { scope: currentScope } = current.conditions;
  let scope = currentScope;
  if (named.kind === 'area') {
    scope = areaScope(area);
  } else if (named.kind === 'cities') {
    scope = citiesScope(named.cityCodes);
  } else if (named.kind === 'both') {
    conflicts.push(scopeConflict(named.cityCodes, area !== null));
    scope = citiesScope([]);
  }

  const params = findParams(text, indicatorIds, notes);
  conflicts.push(...paramConflicts(text).filter(conflict => indicatorIds.some(id => paramApplies(conflict.key, id))));
  const parsed: Composition = {
    ...current,
    conditions: { years: said.length > 0 ? years : [DEFAULT_YEAR], scope: currentScope, indicatorIds },
    params
  };
  return {
    ok: true,
    composition: withScope(parsed, scope),
    conflicts,
    notes,
    keptScope: named.kind === 'none' && scopeCityCodes(currentScope).length > 0
  };
}

const ANSWERS: Readonly<Record<ConflictKey, (text: string) => boolean>> = {
  years: text => mentionedYears(text).some(year => SIMULATION_YEARS.includes(year)),
  scope: text => {
    const { kind } = saidScope(text);
    return kind === 'area' || kind === 'cities';
  },
  rule: text => {
    const said = saidRule(text);
    return said === 'old' || said === 'new';
  },
  recognition: text => {
    const said = saidRecognition(text);
    return said === 'intersect' || said === 'half';
  },
  popChange: text => saidPopChanges(text).length === 1 || /人口(不变|恢复)/.test(text)
};

/** 这句话回答之后还没解决的冲突；恢复标准口径时几项参数都算回答了 */
export function conflictsAfterReply(conflicts: readonly ConditionConflict[], input: string): ConditionConflict[] {
  const text = plainPrompt(input);
  const standard = /(恢复|改回|回到|按)标准口径/.test(text);
  return conflicts.filter(({ key }) => !ANSWERS[key](text) && !(standard && key !== 'years' && key !== 'scope'));
}

/** 把编排写成一句指令；条件不全时是空字符串。全省、一两个市或自定义范围时，解析这句话能得到同样的年份、范围、第一项指标和参数 */
export function describeComposition({ conditions, params }: Composition): string {
  const { years, scope: range, indicatorIds } = conditions;
  const [first] = indicatorIds;
  const cityCodes = range.kind === 'cities' ? range.cityCodes : [];
  if (years.length === 0 || first === undefined || (range.kind === 'cities' ? cityCodes.length === 0 : !range.area)) {
    return '';
  }
  const names = cityCodes.map(code => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code);
  let scope: string;
  if (range.kind === 'area') {
    scope = range.area ? areaLabel(range.area) : '';
  } else if (cityCodes.length === ALL_CITIES.length) {
    scope = '全省';
  } else {
    scope = names.length <= 2 ? names.join('、') : `${names[0]}等 ${names.length} 个市`;
  }
  const name = indicatorName(first, params);
  const subject = indicatorIds.length === 1 ? name : `${name}等 ${indicatorIds.length} 项指标`;
  const uses = (key: 'rule' | 'recognition' | 'popChange') => indicatorIds.some(id => paramApplies(key, id));
  const ways = [
    ...(params.rule === 'old' && uses('rule') ? ['卫生服务站步行 5 分钟的旧规程'] : []),
    ...(params.recognition === 'intersect' && uses('recognition') ? ['“相交即算”的覆盖认定'] : []),
    ...(params.popChange !== 0 && uses('popChange')
      ? [`常住人口${params.popChange > 0 ? '增加' : '减少'} ${Math.abs(params.popChange)}%`]
      : [])
  ];
  const yearsText = years.toSorted((a, b) => a - b).join('、');
  const lead = ways.length > 0 ? `按${ways.join('、')}，` : '';
  // 自定义范围放在年份前面："计算自定义范围「江宁片区」2025 年……"
  return range.kind === 'area'
    ? `${lead}计算${scope} ${yearsText} 年${subject}`
    : `${lead}计算 ${yearsText} 年${scope}${subject}`;
}

const SCOPE_REPLIES: readonly string[] = ['南京市、苏州市', '全省', '无锡市', '徐州市、连云港市', '常州市、镇江市'];

/** 等用户补充范围时占位的回复示例：换一批换一句，不和 avoid 相同 */
export function randomScopeReply(random: () => number, avoid: string): string {
  const pool = SCOPE_REPLIES.filter(item => item !== avoid);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? avoid;
}

/** 随机指令里一定有的指标：社区卫生服务设施覆盖率，计算规程、覆盖认定、步行时长都能演示 */
export const ANCHOR_INDICATOR = 'A-31';

// 随机指令里演示的步行时长：社区卫生的标准是 15 分钟
const RANDOM_WALK_MINUTES: readonly number[] = [5, 10, 20, 30];

// 从列表里不重复地取 count 个，保持原来的先后
function sampleOf<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = items.map((item, index) => ({ item, index }));
  const picked: { item: T; index: number }[] = [];
  while (picked.length < count && pool.length > 0) {
    const [one] = pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1);
    if (one) {
      picked.push(one);
    }
  }
  return picked.toSorted((a, b) => a.index - b.index).map(one => one.item);
}

const joinNames = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join('、')}和${names.at(-1) ?? ''}`;

/**
 * 刷新时换上的一句指令：一定有社区卫生服务设施覆盖率，再随机配一两个年度、一到三个市或全省、另外 0～2 项指标，
 * 以及所选指标用得上的一项参数（也可能是标准口径）；和 avoid 里的话重复时重新组合。解析这句话得到同样的编排。
 * 传了 area（正在用的自定义范围）时范围写它的名称
 */
export function randomPrompt(
  random: () => number,
  avoid: readonly string[] = [],
  area: ScopeArea | null = null
): string {
  let text = '';
  for (let attempt = 0; attempt < 10 && (text === '' || avoid.includes(text)); attempt++) {
    const years = sampleOf(SIMULATION_YEARS, random() < 0.7 ? 1 : 2, random).toSorted((a, b) => a - b);
    const cities = random() < 0.15 ? null : sampleOf(JIANGSU_CITIES, 1 + Math.floor(random() * 3), random);
    const others = SIMULATION_INDICATORS.filter(item => item.id !== ANCHOR_INDICATOR);
    const indicators = [simulationIndicator(ANCHOR_INDICATOR), ...sampleOf(others, Math.floor(random() * 3), random)];
    const ways = [
      '旧规程',
      '相交',
      '时长',
      ...(indicators.some(item => item.model === 'perCapita') ? ['人口'] : []),
      '标准'
    ];
    const way = ways[Math.min(ways.length - 1, Math.floor(random() * ways.length))];
    const percent = (1 + Math.floor(random() * 4)) * POP_CHANGE_RANGE.step;
    const phrase =
      way === '旧规程'
        ? '按卫生服务站步行 5 分钟的旧规程，'
        : way === '相交'
          ? '按“相交即算”的覆盖认定，'
          : way === '人口'
            ? `按常住人口${random() < 0.5 ? '增加' : '减少'} ${percent}%，`
            : '';
    // 演示步行时长：第一项指标换成另一档，名称里就写着时长
    const minutes = RANDOM_WALK_MINUTES[Math.floor(random() * RANDOM_WALK_MINUTES.length)] ?? 10;
    const walked = way === '时长' ? withWalkMinutes(defaultParams(), ANCHOR_INDICATOR, minutes) : defaultParams();
    const names = joinNames(indicators.map(item => indicatorName(item.id, walked)));
    if (area) {
      text = `${phrase}计算${areaLabel(area)} ${years.join('、')} 年${names}`;
    } else {
      const scope = cities === null ? '全省' : cities.map(city => city.name).join('、');
      text = `${phrase}计算 ${years.join('、')} 年${scope}${names}`;
    }
  }
  return text;
}
