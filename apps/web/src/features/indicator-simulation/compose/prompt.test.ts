// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams } from '../model/params';
import { areaScope, citiesScope, scopeCityCodes } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { emptyComposition, rememberedScopes, withArea, withScopeKind } from './composition';
import { areaPrompt, describeComposition, parsePrompt, PROMPT_EXAMPLES, randomPrompt } from './prompt';

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

  it('没写年份按 2025，没写城市或写了全省按全省；不在可选范围的年份不算', () => {
    expect(parsed('计算公园绿地覆盖率').conditions).toMatchObject({ years: [2025], scope: citiesScope(ALL) });
    expect(parsed('计算 2019 年全省公园绿地覆盖率').conditions).toMatchObject({ years: [2025], scope: citiesScope(ALL) });
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
  it('说了自定义范围时用记下的范围；还没有范围时说明原因', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '江宁片区');
    const current = withArea(emptyComposition(), area);
    const result = parsePrompt('按上传的范围计算 2024 年社区卫生服务设施覆盖率', current);
    expect(result.ok && result.composition.conditions).toEqual({
      years: [2024],
      scope: areaScope(area),
      indicatorIds: ['A-31']
    });
    expect(parsePrompt(areaPrompt(area), emptyComposition())).toEqual({ ok: false, reason: 'area' });
  });

  it('没说范围时：正在用自定义范围就接着用；说了城市时改为行政区划，范围仍记着', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS);
    const current = withArea(emptyComposition(), area);
    const kept = parsePrompt('计算人均公园绿地面积', current);
    expect(kept.ok && kept.composition.conditions.scope).toEqual(areaScope(area));
    const cities = parsePrompt('计算苏州市人均公园绿地面积', current);
    expect(cities.ok && cities.composition.conditions.scope).toEqual(citiesScope(['320500']));
    expect(cities.ok && rememberedScopes(cities.composition).area).toBe(area);
    const other = parsePrompt('计算人均公园绿地面积', withScopeKind(current, 'cities'));
    expect(other.ok && other.composition.conditions.scope).toEqual(citiesScope(ALL));
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
