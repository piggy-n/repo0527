// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams } from '../model/params';
import { areaScope, citiesScope, scopeCityCodes } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { emptyComposition, rememberedScopes, withArea, withScopeKind } from './composition';
import { conflictsAfterReply, areaPrompt, describeComposition, parsePrompt, PROMPT_EXAMPLES, randomPrompt, randomScopeReply, saidScope } from './prompt';

const ALL = JIANGSU_CITIES.map(city => city.code);
const parsed = (text: string) => {
  const result = parsePrompt(text);
  if (!result.ok) {
    throw new Error(`应能解析：${text}`);
  }
  return result.composition;
};

describe('parsePrompt', () => {
  it('三条示例：各填一项参数，其余是标准口径', () => {
    const [rule = '', recognition = '', population = ''] = PROMPT_EXAMPLES;

    expect(parsed(rule)).toMatchObject({
      conditions: { years: [2025], scope: citiesScope(['320100']), indicatorIds: ['A-31'] },
      params: { ...defaultParams(), rule: 'old' }
    });
    expect(parsed(recognition)).toMatchObject({
      conditions: { years: [2025], scope: citiesScope(['320100']), indicatorIds: ['B-65'] },
      params: { ...defaultParams(), recognition: 'intersect' }
    });
    expect(parsed(population)).toMatchObject({
      conditions: { years: [2025], scope: citiesScope(['320100']), indicatorIds: ['A-39'] },
      params: { ...defaultParams(), popChange: 10 }
    });
  });

  it('几个年度新的在前，几个市按区划目录，几项指标按句子里的先后', () => {
    const result = parsed('计算 2024、2026 年苏州市、无锡市社区小学覆盖率和人均公园绿地面积');

    expect(result.conditions).toEqual({
      years: [2026, 2024],
      scope: citiesScope(['320200', '320500']),
      indicatorIds: ['A-32', 'A-39']
    });
  });

  it('没写年份按 2025；写了全省是全省；没写范围时留空，由调用方标为待补充', () => {
    expect(parsed('计算公园绿地覆盖率').conditions).toMatchObject({ years: [2025], scope: citiesScope([]) });
    expect(parsed('计算全省公园绿地覆盖率').conditions).toMatchObject({ years: [2025], scope: citiesScope(ALL) });
  });

  it('长的关键词先匹配：人均公共停车场不会再算成公共停车场', () => {
    expect(parsed('计算人均公共停车场、停车楼用地面积').conditions.indicatorIds).toEqual(['B08-2']);
  });

  it('参数只在所选指标用得上时才改', () => {
    expect(parsed('按旧规程计算南京市公园绿地覆盖率').params.rule).toBe('new');
    expect(parsed('按人口增加 10% 计算公园绿地覆盖率').params.popChange).toBe(0);
  });

  it('人口变化按 5% 取整，超出范围的按 20%；减少写成负数', () => {
    expect(parsed('按常住人口减少 12% 计算人均公园绿地面积').params.popChange).toBe(-10);
    expect(parsed('按常住人口增加 30% 计算人均公园绿地面积').params.popChange).toBe(20);
  });

  it('认不出指标时说明', () => {
    expect(parsePrompt('今天适合计算什么')).toEqual({ ok: false, reason: 'indicator' });
  });
});

describe('describeComposition', () => {
  it('条件不全时是空字符串', () => {
    expect(describeComposition(emptyComposition())).toBe('');
  });

  it('写出年份、范围、指标和偏离标准口径的参数；解析回去得到同样的编排', () => {
    for (const example of PROMPT_EXAMPLES) {
      const composition = parsed(example);
      const text = describeComposition(composition);
      expect(parsed(text)).toEqual(composition);
    }
    expect(describeComposition(parsed(PROMPT_EXAMPLES[0] ?? ''))).toBe(
      '按卫生服务站步行 5 分钟的旧规程，计算 2025 年南京市社区卫生服务设施步行15分钟覆盖率'
    );
  });

  it('多个市、多项指标时写"等"', () => {
    const composition = parsed('计算 2025 年南京市、苏州市、无锡市社区卫生服务设施覆盖率和人均公园绿地面积');
    expect(describeComposition(composition)).toBe('计算 2025 年南京市等 3 个市社区卫生服务设施步行15分钟覆盖率等 2 项指标');
    const all = { ...composition, conditions: { ...composition.conditions, scope: citiesScope(ALL) } };
    expect(describeComposition(all)).toContain('年全省');
  });
});

// 可重复的随机数（线性同余），每个种子一串
const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
};

const minutesOf = (text: string) => parsed(text).params.walkMinutes;

describe('指令里的步行时长（ADR 0125）', () => {
  it('紧跟在指标后面的只改这一项；名称里写标准时长的不算改', () => {
    expect(minutesOf('计算社区卫生服务设施步行10分钟覆盖率')).toEqual({ 'A-31': 10 });
    expect(minutesOf('计算社区小学步行20分钟覆盖率和社区中学覆盖率')).toEqual({ 'A-32': 20 });
    expect(minutesOf('计算社区卫生服务设施步行15分钟覆盖率')).toEqual({});
    expect(minutesOf('计算 2025 年南京市公园绿地、广场步行 5 分钟覆盖率')).toEqual({});
    expect(minutesOf('计算社区卫生步行 20 分钟覆盖率')).toEqual({ 'A-31': 20 });
  });

  it('没说指标的改所选的全部步行类指标，单独说了的优先，标准时长不记', () => {
    expect(minutesOf('按步行 10 分钟，计算社区卫生服务设施覆盖率和公交车站覆盖率')).toEqual({ 'A-31': 10, 'A08-2': 10 });
    expect(minutesOf('按步行 10 分钟，计算社区卫生服务设施覆盖率和社区小学覆盖率')).toEqual({ 'A-31': 10 });
    expect(minutesOf('按步行 20 分钟，计算社区卫生服务设施覆盖率和社区小学步行 25 分钟覆盖率')).toEqual({
      'A-31': 20,
      'A-32': 25
    });
  });

  it('不在档位上的取最近一档，超过上限的取上限；不是步行类的不改', () => {
    expect(minutesOf('按步行 12 分钟计算社区卫生服务设施覆盖率')).toEqual({ 'A-31': 10 });
    expect(minutesOf('按步行 40 分钟计算社区卫生服务设施覆盖率')).toEqual({ 'A-31': 30 });
    expect(minutesOf('按步行 40 分钟计算公交车站覆盖率')).toEqual({ 'A08-2': 15 });
    expect(minutesOf('按步行 10 分钟计算人均公园绿地面积')).toEqual({});
    expect(minutesOf('按步行 10 分钟计算消防救援覆盖率')).toEqual({});
  });

  it('旧规程那句话里的"步行 5 分钟"不是要改时长', () => {
    const composition = parsed('按卫生服务站步行 5 分钟的旧规程，计算 2025 年南京市社区卫生服务设施覆盖率');
    expect(composition.params.rule).toBe('old');
    expect(composition.params.walkMinutes).toEqual({});
  });

  it('写成一句话带着改后的时长，解析回去相同', () => {
    const composition = parsed('按步行 10 分钟，计算 2025 年南京市社区卫生服务设施覆盖率');
    const text = describeComposition(composition);
    expect(text).toContain('社区卫生服务设施步行10分钟覆盖率');
    expect(parsed(text)).toMatchObject({ params: composition.params, conditions: composition.conditions });
  });

  it('随机的指令里有的改了时长，解析得到名称里写的时长', () => {
    const texts = Array.from({ length: 60 }, (_, index) => randomPrompt(seeded(index + 1)));
    const walked = texts.filter(text => Object.keys(minutesOf(text)).length > 0);
    expect(walked.length).toBeGreaterThan(5);
    for (const text of walked) {
      const minutes = parsed(text).params.walkMinutes['A-31'];
      expect(text).toContain(`社区卫生服务设施步行${minutes}分钟覆盖率`);
    }
  });
});

describe('randomPrompt', () => {
  it('一定有社区卫生覆盖率，排在第一；城市、年度、指标、参数的组合各不相同', () => {
    const texts = Array.from({ length: 40 }, (_, index) => randomPrompt(seeded(index + 1)));
    const results = texts.map(text => parsed(text));
    expect(results.every(item => item.conditions.indicatorIds[0] === 'A-31')).toBe(true);
    expect(new Set(texts).size).toBeGreaterThan(30);
    expect(new Set(results.map(item => scopeCityCodes(item.conditions.scope).join())).size).toBeGreaterThan(10);
    expect(new Set(results.map(item => item.conditions.years.join())).size).toBeGreaterThan(5);
    expect(new Set(results.map(item => item.conditions.indicatorIds.length))).toEqual(new Set([1, 2, 3]));
    const scenarios = new Set(results.map(({ params }) => `${params.rule}/${params.recognition}/${params.popChange}`));
    expect(scenarios.size).toBeGreaterThan(3);
  });

  it('和要避开的话重复时重新组合', () => {
    const once = randomPrompt(seeded(7));
    expect(randomPrompt(seeded(7), [once])).not.toBe(once);
  });
});

describe('自定义范围的指令（ADR 0121）', () => {
  it('说了自定义范围时用记下的范围；还没有范围时是待补充的自定义范围', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '江宁片区');
    const current = withArea(emptyComposition(), area);
    const result = parsePrompt('按上传的范围计算 2024 年社区卫生服务设施覆盖率', current);
    expect(result.ok && result.composition.conditions).toEqual({
      years: [2024],
      scope: areaScope(area),
      indicatorIds: ['A-31']
    });
    const none = parsePrompt(areaPrompt(area), emptyComposition());
    expect(none.ok && none.composition.conditions.scope).toEqual(areaScope(null));
    expect(none.ok && none.conflicts).toEqual([]);
  });

  it('没说范围时：正在用自定义范围就接着用；说了城市时改为行政区划，范围仍记着', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS);
    const current = withArea(emptyComposition(), area);
    const kept = parsePrompt('计算人均公园绿地面积', current);
    expect(kept.ok && kept.composition.conditions.scope).toEqual(areaScope(area));
    const cities = parsePrompt('计算苏州市人均公园绿地面积', current);
    expect(cities.ok && cities.composition.conditions.scope).toEqual(citiesScope(['320500']));
    expect(cities.ok && rememberedScopes(cities.composition).area).toBe(area);
    // 切到了行政区划、一个市也没选：待补充，自定义范围仍记着
    const other = parsePrompt('计算人均公园绿地面积', withScopeKind(current, 'cities'));
    expect(other.ok && other.composition.conditions.scope).toEqual(citiesScope([]));
    expect(other.ok && rememberedScopes(other.composition).area).toBe(area);
  });

  it('「」里是范围的名称：名称里的年份、城市、指标不算条件', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '2023南京公园绿地片区');
    const result = parsePrompt(areaPrompt(area), withArea(emptyComposition(), area));
    expect(result.ok && result.composition.conditions).toEqual({
      years: [2025],
      scope: areaScope(area),
      indicatorIds: ['A-31', 'A-39']
    });
  });

  it('写成一句话、解析回去得到同样的范围；随机的示例写出范围的名称', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '江宁片区');
    const current = withArea(emptyComposition(), area);
    const result = parsePrompt('计算自定义范围 2025 年社区卫生服务设施覆盖率', current);
    if (!result.ok) {
      throw new Error('应能解析');
    }
    const text = describeComposition(result.composition);
    expect(text).toBe('计算自定义范围「江宁片区」 2025 年社区卫生服务设施步行15分钟覆盖率');
    expect(parsePrompt(text, current)).toEqual(result);
    const random = randomPrompt(seeded(3), [], area);
    expect(random).toContain('计算自定义范围「江宁片区」 ');
    const parsedRandom = parsePrompt(random, current);
    expect(parsedRandom.ok && parsedRandom.composition.conditions.scope).toEqual(areaScope(area));
  });
});

const parsedFull = (text: string, current = emptyComposition()) => {
  const result = parsePrompt(text, current);
  if (!result.ok) {
    throw new Error(`应能解析：${text}`);
  }
  return result;
};
const conflictKeys = (text: string, current = emptyComposition()) => parsedFull(text, current).conflicts.map(item => item.key);

describe('范围待补充（ADR 0129）', () => {
  it('没写范围时其余条件照常解析，范围留空，不算冲突', () => {
    const result = parsedFull('按卫生服务站步行 5 分钟的旧规程，计算 2024、2025 年社区卫生服务设施覆盖率和人均公园绿地面积');
    expect(result.composition.conditions).toEqual({ years: [2025, 2024], scope: citiesScope([]), indicatorIds: ['A-31', 'A-39'] });
    expect(result.composition.params.rule).toBe('old');
    expect(result.conflicts).toEqual([]);
    expect(result.keptScope).toBe(false);
  });

  it('页面上已有范围时接着用，记为沿用', () => {
    const current = parsed('计算 2025 年苏州市公园绿地覆盖率');
    const result = parsedFull('计算 2024 年人均公园绿地面积', current);
    expect(result.composition.conditions.scope).toEqual(citiesScope(['320500']));
    expect(result.keptScope).toBe(true);
  });

  it('"换一批"的语句去掉范围后都进入待补充，其余条件和原来相同', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const text = randomPrompt(seeded(seed));
      const scoped = parsed(text);
      // 语句里的范围是"全省"或顿号隔开的市名，紧跟在年后面
      const stripped = text.replace(/年(?:全省|[\u4e00-\u9fa5]{2,3}市(?:、[\u4e00-\u9fa5]{2,3}市)*)/, '年');
      const result = parsedFull(stripped);
      expect(stripped).not.toBe(text);
      expect(result.composition.conditions.scope).toEqual(citiesScope([]));
      expect(result.composition.conditions.years).toEqual(scoped.conditions.years);
      expect(result.composition.conditions.indicatorIds).toEqual(scoped.conditions.indicatorIds);
      expect(result.composition.params).toEqual(scoped.params);
      expect(result.conflicts).toEqual([]);
    }
  });

  it('等范围时的回复示例换一句，不和当前的重复', () => {
    expect(randomScopeReply(() => 0, '南京市、苏州市')).toBe('全省');
    expect(randomScopeReply(() => 0.99, '常州市、镇江市')).toBe('徐州市、连云港市');
    for (let index = 0; index < 20; index++) {
      expect(randomScopeReply(seeded(index + 1), '全省')).not.toBe('全省');
    }
  });
});

describe('条件冲突（ADR 0129）', () => {
  it('写的年份都不可选：留空并追问，不替用户换成 2025 年', () => {
    const result = parsedFull('计算 2019 年南京市社区卫生服务设施覆盖率');
    expect(result.composition.conditions.years).toEqual([]);
    expect(result.conflicts[0]).toMatchObject({ key: 'years', label: '年份' });
    expect(result.conflicts[0]?.question).toContain('2019');
    expect(result.conflicts[0]?.options.map(option => option.say)).toEqual(['改成 2026 年', '改成 2025 年']);
  });

  it('部分年份不可选：按可选的算，说明丢了哪一年', () => {
    const result = parsedFull('计算 2019、2025 年南京市社区卫生服务设施覆盖率');
    expect(result.composition.conditions.years).toEqual([2025]);
    expect(result.conflicts).toEqual([]);
    expect(result.notes).toEqual(['没有 2019 年的数据，已按 2025 年计算']);
  });

  it('同一项参数说了两种：不替用户选，用标准口径等确认；所选指标用不上时不问', () => {
    const rule = parsedFull('按旧规程和新规程计算 2025 年南京市社区卫生服务设施覆盖率');
    expect(rule.conflicts.map(item => item.key)).toEqual(['rule']);
    expect(rule.composition.params.rule).toBe('new');
    expect(conflictKeys('按旧规程和新规程计算 2025 年南京市人均公园绿地面积')).toEqual([]);
    expect(conflictKeys('按相交即算和覆盖 50% 计算 2025 年南京市公园绿地覆盖率')).toEqual(['recognition']);
    const pop = parsedFull('按常住人口增加 10%、人口减少 5%，计算 2025 年南京市人均公园绿地面积');
    expect(pop.conflicts.map(item => item.key)).toEqual(['popChange']);
    expect(pop.composition.params.popChange).toBe(0);
  });

  it('同时说自定义范围和城市：范围留空等确认；"换成"说的是后面那个', async () => {
    const result = parsedFull('计算自定义范围和南京市 2025 年社区卫生服务设施覆盖率');
    expect(result.conflicts.map(item => item.key)).toEqual(['scope']);
    expect(result.composition.conditions.scope).toEqual(citiesScope([]));
    expect(result.conflicts[0]?.options.map(option => option.say)).toEqual(['用自定义范围', '南京市']);

    expect(saidScope('把自定义范围换成南京市')).toEqual({ kind: 'cities', cityCodes: ['320100'] });
    expect(saidScope('南京市改回自定义范围')).toEqual({ kind: 'area' });
    expect(saidScope('计算覆盖率')).toEqual({ kind: 'none' });
  });

  it('参数用不上时不阻断，写进说明', () => {
    const result = parsedFull('按旧规程计算 2025 年南京市人均公园绿地面积');
    expect(result.conflicts).toEqual([]);
    expect(result.composition.params.rule).toBe('new');
    expect(result.notes).toEqual(['所选指标不适用计算规程，已按标准口径']);
    expect(parsedFull('按相交即算计算 2025 年南京市人均公园绿地面积').notes).toEqual(['所选指标不适用覆盖认定，已按标准口径']);
    expect(parsedFull('按人口增加 10% 计算 2025 年南京市公园绿地覆盖率').notes).toEqual(['所选指标不适用常住人口变化，已按标准口径']);
    expect(parsedFull('按步行 10 分钟计算 2025 年南京市人均公园绿地面积').notes).toEqual(['所选指标不适用步行时长，已按标准口径']);
  });

  it('说了回答才算解决：按句子里实际说的判断', () => {
    const conflicts = [
      ...parsedFull('计算 2019 年南京市社区卫生服务设施覆盖率').conflicts,
      ...parsedFull('按旧规程和新规程计算 2025 年南京市社区卫生服务设施覆盖率').conflicts,
      ...parsedFull('计算自定义范围和南京市 2025 年社区卫生服务设施覆盖率').conflicts
    ];
    const keys = (text: string) => conflictsAfterReply(conflicts, text).map(item => item.key);
    expect(keys('再加上人均公园绿地')).toEqual(['years', 'rule', 'scope']);
    expect(keys('改成 2025 年')).toEqual(['rule', 'scope']);
    expect(keys('改成 2019 年')).toEqual(['years', 'rule', 'scope']);
    expect(keys('按新规程计算')).toEqual(['years', 'scope']);
    expect(keys('南京市')).toEqual(['years', 'rule']);
    expect(keys('用自定义范围')).toEqual(['years', 'rule']);
    expect(keys('恢复标准口径')).toEqual(['years', 'scope']);
  });
});
