// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams } from '../model/params';
import { emptyComposition } from './composition';
import { describeComposition, parsePrompt, PROMPT_EXAMPLES, randomPrompt } from './prompt';

const ALL = JIANGSU_CITIES.map(city => city.code);
const parsed = (text: string) => {
  const result = parsePrompt(text);
  if (!result) {
    throw new Error(`应能解析：${text}`);
  }
  return result;
};

describe('parsePrompt', () => {
  it('三条示例：各填一项参数，其余是标准口径', () => {
    const [rule = '', recognition = '', population = ''] = PROMPT_EXAMPLES;

    expect(parsed(rule)).toEqual({
      conditions: { years: [2025], cityCodes: ['320100'], indicatorIds: ['A-31'] },
      params: { ...defaultParams(), rule: 'old' }
    });
    expect(parsed(recognition)).toEqual({
      conditions: { years: [2025], cityCodes: ['320100'], indicatorIds: ['B-65'] },
      params: { ...defaultParams(), recognition: 'intersect' }
    });
    expect(parsed(population)).toEqual({
      conditions: { years: [2025], cityCodes: ['320100'], indicatorIds: ['A-39'] },
      params: { ...defaultParams(), popChange: 10 }
    });
  });

  it('几个年度新的在前，几个市按区划目录，几项指标按句子里的先后', () => {
    const result = parsed('推演 2024、2026 年苏州市、无锡市社区小学覆盖率和人均公园绿地面积');

    expect(result.conditions).toEqual({ years: [2026, 2024], cityCodes: ['320200', '320500'], indicatorIds: ['A-32', 'A-39'] });
  });

  it('没写年份按 2025，没写城市或写了全省按全省；不在可选范围的年份不算', () => {
    expect(parsed('推演公园绿地覆盖率').conditions).toMatchObject({ years: [2025], cityCodes: ALL });
    expect(parsed('推演 2019 年全省公园绿地覆盖率').conditions).toMatchObject({ years: [2025], cityCodes: ALL });
  });

  it('长的关键词先匹配：人均公共停车场不会再算成公共停车场', () => {
    expect(parsed('推演人均公共停车场、停车楼用地面积').conditions.indicatorIds).toEqual(['B08-2']);
  });

  it('参数只在所选指标用得上时才改', () => {
    expect(parsed('按旧规程推演南京市公园绿地覆盖率').params.rule).toBe('new');
    expect(parsed('按人口增加 10% 推演公园绿地覆盖率').params.popChange).toBe(0);
  });

  it('人口变化按 5% 取整，超出范围的按 20%；减少写成负数', () => {
    expect(parsed('按常住人口减少 12% 推演人均公园绿地面积').params.popChange).toBe(-10);
    expect(parsed('按常住人口增加 30% 推演人均公园绿地面积').params.popChange).toBe(20);
  });

  it('认不出指标时为 null', () => {
    expect(parsePrompt('今天适合推演什么')).toBeNull();
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
      '按卫生服务站步行 5 分钟的旧规程，推演 2025 年南京市社区卫生服务设施步行15分钟覆盖率'
    );
  });

  it('多个市、多项指标时写"等"', () => {
    const composition = parsed('推演 2025 年南京市、苏州市、无锡市社区卫生服务设施覆盖率和人均公园绿地面积');
    expect(describeComposition(composition)).toBe('推演 2025 年南京市等 3 个市社区卫生服务设施步行15分钟覆盖率等 2 项指标');
    expect(describeComposition({ ...composition, conditions: { ...composition.conditions, cityCodes: ALL } })).toContain('年全省');
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
    expect(new Set(results.map(item => item.conditions.cityCodes.join())).size).toBeGreaterThan(10);
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
