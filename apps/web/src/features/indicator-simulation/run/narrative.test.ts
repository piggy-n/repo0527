// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { createCalculator } from '../model/calculator';
import { defaultParams, type SimulationConditions } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { describeChanges, em, type NarrativeInput, plainText, primaryIndicator, rich, stepRecord } from './narrative';

const conditions: SimulationConditions = {
  years: [2026, 2025],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['B-65', 'A-31', 'A-39']
};

async function inputOf(patch: Partial<NarrativeInput> = {}): Promise<NarrativeInput> {
  return {
    calculator: createCalculator(await loadTestAtlas()),
    conditions,
    params: defaultParams(),
    baseParams: defaultParams(),
    decided: { qc: false, spatial: false },
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
  it('条件解析：年度、范围、指标和两类模型的项数', async () => {
    const input = await inputOf();
    expect(lines(input, 'parse')).toEqual([
      '推演 2025、2026 年 · 全省 13 市 · 3 项指标：公园绿地覆盖率、社区卫生覆盖率、人均公园绿地。',
      '其中 2 项覆盖率按服务圈推演，1 项人均值按设施面积与人口推演；规划 7 个步骤，数据准备 3 路并行。'
    ]);
    expect(stepRecord('parse', input).metrics.map(metric => metric.format(metric.value))).toEqual(['2 个', '13 市', '95 个', '3 项']);
  });

  it('数据核查：没决定时只说发现了缺失；决定后写处理方式，参数里出现缺失处理', async () => {
    const pending = await inputOf();
    const missing = pending.calculator.missingDistricts(2026, conditions.cityCodes);
    expect(lines(pending, 'qc')[1]).toContain(`发现 ${missing.length} 个区县缺少 2026 年人口`);
    expect(lines(pending, 'qc')).toHaveLength(2);
    expect(stepRecord('qc', pending).params).toEqual([]);

    const decided = await inputOf({ decided: { qc: true, spatial: false }, params: { ...defaultParams(), missing: { kind: 'exclude' } } });
    expect(lines(decided, 'qc').at(-1)).toBe('按人工确认：剔除缺失区县，继续推演。');
    expect(stepRecord('qc', decided).summaries.qc).toBe(`已剔除 ${missing.length} 个区县`);
    expect(stepRecord('qc', decided).params[0]).toEqual({ label: '缺失数据处理', value: '剔除缺失区县', from: '按趋势插补' });
  });

  it('空间分析：服务半径随步行速度；参数和基准不同时标出原值', async () => {
    const input = await inputOf({ params: { ...defaultParams(), walkSpeed: 75 } });
    expect(lines(input, 'spatial')[0]).toMatch(/生成 375 米服务圈/);
    expect(stepRecord('spatial', input).summaries.spatial).toBe('服务圈 375/1125 米');
    expect(stepRecord('spatial', input).params[0]).toEqual({ label: '步行速度', value: '75 米/分钟', from: '60 米/分钟' });
  });

  it('结论：主指标、达标、短板与建议情景，数字和模型一致；摘要写这一轮的版本号', async () => {
    const input = await inputOf({ version: 3 });
    const [conclusion, idea] = lines(input, 'report');
    expect(primaryIndicator(conditions)).toBe('B-65');
    expect(conclusion).toMatch(/^结论：2026 年公园绿地覆盖率全省 64\.6%，5\/13 市达到演示目标；短板集中在 /);
    expect(idea).toBe('建议情景：规划新增 20% 公园绿地，预计全省 64.6% → 70.3%，达标 5 → 7 市。');
    expect(stepRecord('report', input).summaries.report).toBe('v3 已生成');
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
    expect(describeChanges(['walkSpeed', 'popCaliber'], defaultParams(), { ...defaultParams(), walkSpeed: 70, popCaliber: 'registered' }, conditions)).toEqual([
      '步行速度 60 米/分钟 → 70 米/分钟',
      '人口口径 常住人口 → 户籍人口'
    ]);
  });
});
