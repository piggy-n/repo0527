// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { createCalculator } from '../model/calculator';
import { defaultParams, type SimulationConditions, type SimulationParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { describeChanges, em, type NarrativeInput, plainText, primaryIndicator, rich, stepRecord } from './narrative';

const conditions: SimulationConditions = {
  years: [2026, 2025],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['B-65', 'A-31', 'A-39']
};
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });

async function inputOf(patch: Partial<NarrativeInput> = {}): Promise<NarrativeInput> {
  return {
    calculator: createCalculator(await loadTestAtlas()),
    conditions,
    params: defaultParams(),
    baseParams: defaultParams(),
    version: 1,
    ...patch
  };
}

const lines = (input: NarrativeInput, group: Parameters<typeof stepRecord>[0]) =>
  stepRecord(group, input).blocks.flatMap(block => block.lines.map(line => plainText(line.text)));

describe('rich', () => {
  it('em() 插入的部分强调，数字原样', () => {
    expect(rich`共 ${3} 项，${em('64.6%')} 达标`).toEqual(['共 ', '3', ' 项，', { em: '64.6%' }, ' 达标']);
    expect(plainText(rich`a${em('b')}c`)).toBe('abc');
  });
});

describe('stepRecord', () => {
  it('条件解析：年度、范围、指标和两类模型的项数；标准口径时不提模拟情景', async () => {
    const input = await inputOf();
    expect(lines(input, 'parse')).toEqual([
      '推演 2025、2026 年 · 全省 13 市 · 3 项指标：公园绿地覆盖率、社区卫生覆盖率、人均公园绿地。',
      '其中 2 项覆盖率按服务范围推演，1 项人均值按用地面积与人口推演；规划 7 个步骤，数据准备 3 路并行。'
    ]);
    expect(stepRecord('parse', input).metrics.map(metric => metric.format(metric.value))).toEqual(['2 个', '13 市', '95 个', '3 项']);
  });

  it('条件解析：有模拟情景时写明是哪几项、偏离了什么', async () => {
    const input = await inputOf({ params: withPatch({ rule: 'old' }) });
    expect(lines(input, 'parse').at(-1)).toBe('社区卫生覆盖率按模拟情景推演（旧规程），不改指标的标准定义。');
  });

  it('数据准备：人口用七普常住人口；常住人口变化时写明按多少计算', async () => {
    const standard = await inputOf();
    const changed = await inputOf({ params: withPatch({ popChange: 10 }) });
    const census = JIANGSU_CITIES.length;

    expect(lines(standard, 'prep')[0]).toMatch(new RegExp(`^读取 ${census} 个市城区所在区的七普常住人口，合计 [\\d.]+ 万人`));
    expect(lines(standard, 'prep').some(line => line.startsWith('模拟情景'))).toBe(false);
    expect(lines(changed, 'prep')[1]).toMatch(/^模拟情景：常住人口 \+10%，按 [\d.]+ 万人计算人均值。$/);
    expect(stepRecord('prep', changed).params).toEqual([{ label: '常住人口变化', value: '+10%', from: '0%' }]);
  });

  it('数据核查：三类数据齐全，不再停下来问', async () => {
    const input = await inputOf();
    expect(lines(input, 'qc')[1]).toBe('95 个区县的人口、设施坐标和住宅用地都齐全，没有缺失。');
    expect(stepRecord('qc', input).summaries.qc).toBe('数据完整');
  });

  it('空间分析：服务范围按 Excel 的距离，旧规程、相交即算各有一句；参数和基准不同时标出原值', async () => {
    const standard = await inputOf();
    expect(lines(standard, 'spatial')[0]).toMatch(/生成 300 米服务范围，覆盖住宅用地/);
    expect(stepRecord('spatial', standard).summaries.spatial).toBe('服务范围 300/1000 米');

    const scenario = await inputOf({ params: withPatch({ rule: 'old', recognition: 'intersect' }) });
    expect(lines(scenario, 'spatial').filter(line => line.startsWith('模拟情景'))).toEqual([
      '模拟情景：按 旧规程，卫生服务站、文化活动站按步行 5 分钟（300 米），服务中心仍为 15 分钟。',
      '模拟情景：覆盖认定改为 相交即算，与服务范围相交的住宅图斑都算覆盖。'
    ]);
    expect(stepRecord('spatial', scenario).summaries.spatial).toBe('服务范围 300 米');
    expect(stepRecord('spatial', scenario).params).toEqual([
      { label: '计算规程', value: '旧规程', from: '新规程' },
      { label: '覆盖认定', value: '相交即算', from: '覆盖 ≥ 50%' }
    ]);
  });

  it('结论：主指标、达标与短板；摘要写这一轮的版本号', async () => {
    const input = await inputOf({ version: 3 });
    const report = lines(input, 'report');
    expect(primaryIndicator(conditions)).toBe('B-65');
    expect(report).toHaveLength(1);
    expect(report[0]).toMatch(/^结论：2026 年公园绿地覆盖率全省 66\.6%，5\/13 市达到目标；短板集中在 /);
    expect(stepRecord('report', input).summaries.report).toBe('v3 已生成');
  });

  it('结论：模拟情景和标准口径对比', async () => {
    const input = await inputOf({ params: withPatch({ recognition: 'intersect' }) });
    const report = lines(input, 'report');
    expect(report[1]).toMatch(/^模拟情景（相交即算）较标准口径 \+[\d.]+ 个百分点：全省 66\.6% → [\d.]+%，达标 5 → \d+ 市。$/);
  });

  it('同样的状态得到同样的叙述', async () => {
    const input = await inputOf();
    for (const group of ['parse', 'prep', 'qc', 'spatial', 'compute', 'evaluate', 'report'] as const) {
      expect(lines(input, group)).toEqual(lines({ ...input }, group));
    }
  });
});

describe('describeChanges', () => {
  it('改了的参数项写成"原值 → 新值"', () => {
    expect(describeChanges(['popChange', 'rule'], defaultParams(), withPatch({ popChange: 10, rule: 'old' }), conditions)).toEqual([
      '常住人口变化 0% → +10%',
      '计算规程 新规程 → 旧规程'
    ]);
  });
});
