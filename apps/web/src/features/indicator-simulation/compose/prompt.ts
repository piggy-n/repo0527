import { JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import { SIMULATION_INDICATORS, simulationIndicator } from '../model/indicators';
import { defaultParams, paramApplies, POP_CHANGE_RANGE, type SimulationParams } from '../model/params';
import { type Composition, SIMULATION_YEARS } from './composition';

/** 三条示例指令：每条是"推演条件 + 至多一个参数"，分别用到计算规程、覆盖认定、常住人口变化 */
export const PROMPT_EXAMPLES: readonly string[] = [
  '按卫生服务站步行 5 分钟的旧规程，推演 2025 年南京市社区卫生服务设施覆盖率',
  '按“相交即算”的覆盖认定，推演 2025 年南京市公园绿地、广场步行 5 分钟覆盖率',
  '按常住人口增加 10%，推演 2025 年南京市人均公园绿地面积'
];

/** 没写年份时按 2025 年：计算方法合集的监测年度 */
const DEFAULT_YEAR = 2025;

const ALL_CITIES = JIANGSU_CITIES.map(city => city.code);

// 指标的关键词：全称、简称，以及去掉服务范围和"覆盖率""面积"的核心名称（如"社区卫生服务设施"）
function indicatorKeywords(): { readonly id: string; readonly word: string }[] {
  return SIMULATION_INDICATORS.flatMap(item => {
    const core = item.name
      .replace(/步行\d+分钟/, '')
      .replace(/\d+分钟(可达|出警)?/, '')
      .replace(/\d+(公里|千米)(服务)?/, '')
      .replace(/(覆盖率|面积)$/, '');
    return [...new Set([item.name, item.short, core])].map(word => ({ id: item.id, word }));
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

// 参数只认三种写法，而且只在所选指标用得上时才改，其余保持标准口径
function findParams(text: string, indicatorIds: readonly string[]): SimulationParams {
  const uses = (key: 'rule' | 'recognition' | 'popChange') => indicatorIds.some(id => paramApplies(key, id));
  const standard = defaultParams();
  const pop = /人口(增加|增长|上升|提高|减少|下降|降低)(\d+)%/.exec(text);
  let popChange = 0;
  if (pop && uses('popChange')) {
    const size = Math.min(POP_CHANGE_RANGE.max, Math.round(Number(pop[2]) / POP_CHANGE_RANGE.step) * POP_CHANGE_RANGE.step);
    popChange = /减少|下降|降低/.test(pop[1] ?? '') ? -size : size;
  }
  return {
    ...standard,
    rule: text.includes('旧规程') && uses('rule') ? 'old' : standard.rule,
    recognition: text.includes('相交') && uses('recognition') ? 'intersect' : standard.recognition,
    popChange
  };
}

/** 句子里提到的城市（按区划目录排序）；写了"全省""江苏"时是全部 13 个市 */
export function findCities(text: string): string[] {
  return /全省|江苏/.test(text)
    ? [...ALL_CITIES]
    : JIANGSU_CITIES.filter(city => text.includes(shortRegionName(city.name))).map(city => city.code);
}

/** 解析一句推演指令：年份（没写按 2025）、城市或全省（没写按全省）、指标、参数；认不出指标时为 null */
export function parsePrompt(input: string): Composition | null {
  const text = input.replace(/\s+/g, '');
  const indicatorIds = findIndicators(text);
  if (indicatorIds.length === 0) {
    return null;
  }
  const years = [...new Set([...text.matchAll(/20\d{2}/g)].map(match => Number(match[0])))]
    .filter(year => SIMULATION_YEARS.includes(year))
    .toSorted((a, b) => b - a);
  const cityCodes = findCities(text);
  return {
    conditions: {
      years: years.length > 0 ? years : [DEFAULT_YEAR],
      cityCodes: cityCodes.length > 0 ? cityCodes : ALL_CITIES,
      indicatorIds
    },
    params: findParams(text, indicatorIds)
  };
}

/** 把编排写成一句指令；条件不全时是空字符串。全省或一两个市时，解析这句话能得到同样的年份、范围、第一项指标和参数 */
export function describeComposition({ conditions, params }: Composition): string {
  const { years, cityCodes, indicatorIds } = conditions;
  const [first] = indicatorIds;
  if (years.length === 0 || cityCodes.length === 0 || first === undefined) {
    return '';
  }
  const names = cityCodes.map(code => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code);
  let scope: string;
  if (cityCodes.length === ALL_CITIES.length) {
    scope = '全省';
  } else {
    scope = names.length <= 2 ? names.join('、') : `${names[0]}等 ${names.length} 个市`;
  }
  const name = simulationIndicator(first).name;
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
  return `${ways.length > 0 ? `按${ways.join('、')}，` : ''}推演 ${yearsText} 年${scope}${subject}`;
}

/** 随机指令里一定有的指标：社区卫生服务设施覆盖率，计算规程、覆盖认定都能演示 */
export const ANCHOR_INDICATOR = 'A-31';

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
 * 以及所选指标用得上的一项参数（也可能是标准口径）；和 avoid 里的话重复时重新组合。解析这句话得到同样的编排
 */
export function randomPrompt(random: () => number, avoid: readonly string[] = []): string {
  let text = '';
  for (let attempt = 0; attempt < 10 && (text === '' || avoid.includes(text)); attempt++) {
    const years = sampleOf(SIMULATION_YEARS, random() < 0.7 ? 1 : 2, random).toSorted((a, b) => a - b);
    const cities = random() < 0.15 ? null : sampleOf(JIANGSU_CITIES, 1 + Math.floor(random() * 3), random);
    const others = SIMULATION_INDICATORS.filter(item => item.id !== ANCHOR_INDICATOR);
    const indicators = [simulationIndicator(ANCHOR_INDICATOR), ...sampleOf(others, Math.floor(random() * 3), random)];
    const ways = ['旧规程', '相交', ...(indicators.some(item => item.model === 'perCapita') ? ['人口'] : []), '标准'];
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
    const scope = cities === null ? '全省' : cities.map(city => city.name).join('、');
    text = `${phrase}推演 ${years.join('、')} 年${scope}${joinNames(indicators.map(item => item.name))}`;
  }
  return text;
}
