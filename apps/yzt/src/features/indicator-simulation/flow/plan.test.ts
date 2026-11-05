// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatValue } from '../format';
import { indicatorResult } from '../model/analysis';
import { createCalculator } from '../model/calculator';
import { simulationIndicator } from '../model/indicators';
import { defaultParams, type SimulationConditions, type SimulationParams, withWalkMinutes } from '../model/params';
import { areaScope, citiesScope, scopeDistricts } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { plainText } from '../run/narrative';
import { FLOW_LAYOUT, flowPlan } from './plan';

const conditions: SimulationConditions = {
  years: [2025],
  scope: citiesScope(['320100', '320500']),
  indicatorIds: ['A-31', 'B-65', 'A-39']
};
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
const planOf = async (params = withPatch({ recognition: 'intersect' }), next = conditions) =>
  flowPlan({ calculator: createCalculator(await loadTestAtlas()), conditions: next, params });

describe('flowPlan', () => {
  it('条件解析 → 三路数据 → 核查 → 按指标分支 → 结论；自定义口径的指标多一支标准口径对照', async () => {
    const plan = await planOf();
    expect(plan.nodes.map(node => node.key)).toEqual([
      'parse',
      'pop',
      'poi',
      'land',
      'qc',
      'sa:A-31:0',
      'sa:A-31:1',
      'calc:A-31',
      'calc:A-31:std',
      'sa:B-65:0',
      'sa:B-65:1',
      'calc:B-65',
      'calc:B-65:std',
      'sa:A-39:land',
      'calc:A-39',
      'report'
    ]);
    const parents = (key: string) => plan.edges.filter(([, to]) => to === key).map(([from]) => from);
    expect(parents('qc')).toEqual(['pop', 'poi', 'land']);
    expect(parents('calc:A-31:std')).toEqual(['sa:A-31:0', 'sa:A-31:1']);
    expect(parents('report')).toEqual(['calc:A-31', 'calc:A-31:std', 'calc:B-65', 'calc:B-65:std', 'calc:A-39']);
    expect(plan.nodes.find(node => node.key === 'calc:A-31:std')).toMatchObject({ kind: 'standard', label: '对照 · 标准口径' });
  });

  it('服务范围按 Excel：社区卫生分中心和站点，旧规程的站点 300 米；公园绿地缓冲区和路网服务区取并集；人均类是用地汇总', async () => {
    const plan = await planOf(withPatch({ rule: 'old' }));
    const byKey = (key: string) => plan.nodes.find(node => node.key === key);
    expect([byKey('sa:A-31:0')?.title, byKey('sa:A-31:0')?.detail]).toEqual(['社区卫生服务中心', '步行 15 分钟 · 1 公里']);
    expect(byKey('sa:A-31:1')).toMatchObject({ title: '卫生服务站', detail: '步行 5 分钟（旧规程） · 300 米', scenario: true });
    expect(byKey('sa:B-65:1')).toMatchObject({ title: '路网服务区 · 取并集', detail: '步行 5 分钟 · 300 米' });
    expect(byKey('sa:A-39:land')?.title).toBe('公园绿地汇总');
    expect(byKey('calc:B-65')?.detail).toBe('叠加住宅用地 · 覆盖 ≥ 50%');
    // 公园绿地覆盖率用不上计算规程，不是自定义口径
    expect(plan.nodes.some(node => node.key === 'calc:B-65:std')).toBe(false);
  });

  it('城区面积覆盖率叠加城区面积、相交即算；不受覆盖认定影响', async () => {
    const plan = await planOf(withPatch({ recognition: 'intersect' }), { ...conditions, indicatorIds: ['A-15'] });
    expect(plan.nodes.find(node => node.key === 'calc:A-15')?.detail).toBe('叠加城区面积 · 相交即算');
    expect(plan.nodes.some(node => node.key === 'calc:A-15:std')).toBe(false);
    expect(plan.nodes.find(node => node.key === 'sa:A-15:0')?.detail).toBe('车行 5 分钟 · 3 公里');
  });

  it('节点上的数字和计算一致；不按目标值评价，没有达标、目标的说法（2026-10-30）', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const params = withPatch({ recognition: 'intersect' });
    const plan = flowPlan({ calculator, conditions, params });
    const result = calculator.computeYear(conditions, params, 2025).indicators;
    for (const id of conditions.indicatorIds) {
      const data = indicatorResult(result, id);
      expect(plan.nodes.find(node => node.key === `calc:${id}`)?.title).toBe(formatValue(data.value, simulationIndicator(id)));
    }
    const texts = [
      ...plan.nodes.flatMap(node => [node.title, node.detail]),
      ...plan.lines.map(line => plainText(line.text)),
      ...Object.values(plan.summaries)
    ].join('');
    expect(texts).not.toMatch(/达标|目标/);
    expect(plan.nodes.find(node => node.key === 'report')).toMatchObject({
      title: '3 项指标',
      detail: '南京市、苏州市 · 2025 年'
    });
  });

  it('每个节点都有点亮它的一句话；推理文字写出自定义口径；同样的输入得到同样的图', async () => {
    const plan = await planOf();
    const lit = new Set(plan.lines.map(line => line.node));
    expect(plan.nodes.filter(node => !lit.has(node.key))).toEqual([]);
    expect(plan.lines.map(line => plainText(line.text)).join('')).toContain('覆盖认定按「相交即算」');
    expect(plan.summaries.parse).toBe('2025 年 · 南京市、苏州市 · 3 项 · 自定义口径');
    expect(await planOf()).toEqual(plan);
  });

  it('排布：列按步骤从左到右，节点不重叠，画布放得下所有节点', async () => {
    const plan = await planOf();
    const { nodeWidth, nodeHeight, columnGap, padX } = FLOW_LAYOUT;
    for (const node of plan.nodes) {
      expect(node.x).toBe(padX + node.column * (nodeWidth + columnGap));
      expect(node.x + nodeWidth).toBeLessThanOrEqual(plan.width);
      expect(node.y + nodeHeight).toBeLessThanOrEqual(plan.height);
    }
    const spots = plan.nodes.map(node => `${node.x},${node.y}`);
    expect(new Set(spots).size).toBe(spots.length);
    expect(plan.nodes.find(node => node.key === 'report')?.column).toBe(5);
  });
});

describe('自定义范围的流程图（ADR 0121）', () => {
  it('条件解析写出范围、覆盖的区县；人口、用地、核查只算范围内的部分', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const area = await testArea(calculator.atlas, NANJING_RINGS, '江宁片区');
    const custom = { ...conditions, scope: areaScope(area) };
    const plan = flowPlan({ calculator, conditions: custom, params: defaultParams() });
    const parse = plan.lines.filter(line => line.step === 'parse').map(line => plainText(line.text));
    expect(parse[1]).toBe(
      '监测范围是自定义范围「江宁片区」（地图绘制，279 平方千米），涉及南京市 7 个区县：1 个完整覆盖、6 个部分覆盖；部分覆盖的区县按范围内的面积占比折算人口和用地。'
    );
    expect(plan.nodes.find(node => node.key === 'parse')?.title).toBe('自定义范围「江宁片区」 · 2025 年');
    expect(plan.nodes.find(node => node.key === 'qc')?.title).toBe('7 个区县');
    const people = scopeDistricts(calculator.atlas, custom.scope).reduce(
      (sum, { district, share }) => sum + calculator.districtPopulation(district) * share,
      0
    );
    const digits = { maximumFractionDigits: 1, minimumFractionDigits: 1 };
    expect(plan.nodes.find(node => node.key === 'pop')?.detail).toBe(`${people.toLocaleString('zh-CN', digits)} 万人`);
  });
});

const walking = (indicatorIds = ['A-31']) => ({ ...conditions, indicatorIds });

describe('改过步行时长的流程（ADR 0125）', () => {
  it('服务范围写改后的时长和距离并标为情景；条件解析写明改了什么；计算节点用改后的简称，对照写标准口径', async () => {
    const plan = await planOf(withWalkMinutes(defaultParams(), 'A-31', 10), walking());
    const areas = plan.nodes.filter(node => node.key.startsWith('sa:A-31'));
    expect(areas.map(node => node.detail)).toEqual(['步行 10 分钟 · 500 米', '步行 10 分钟 · 500 米']);
    expect(areas.every(node => node.scenario)).toBe(true);
    const parse = plan.lines.filter(line => line.step === 'parse').map(line => plainText(line.text));
    expect(parse.join()).toContain('步行时长由 15 分钟（1000 米）改为 10 分钟（500 米）');
    expect(parse.join()).toContain('社区卫生10分钟覆盖率');
    expect(plan.nodes.find(node => node.key === 'calc:A-31')?.label).toBe('社区卫生10分钟覆盖率');
    expect(plan.nodes.find(node => node.key === 'calc:A-31:std')?.detail).toBe('社区卫生覆盖率 · 标准口径');
  });

  it('旧规程：服务中心跟随设定的时长，站点仍是 5 分钟', async () => {
    const plan = await planOf({ ...withWalkMinutes(defaultParams(), 'A-31', 20), rule: 'old' }, walking());
    const areas = plan.nodes.filter(node => node.key.startsWith('sa:A-31'));
    expect(areas.map(node => node.detail)).toEqual(['步行 20 分钟 · 1.33 公里', '步行 5 分钟（旧规程） · 300 米']);
  });

  it('没改时不写时长的变化，服务范围不是情景；只改了别的指标时这项不受影响', async () => {
    const plain = await planOf(defaultParams(), walking());
    expect(plain.lines.map(line => plainText(line.text)).join()).not.toContain('步行时长由');
    const other = await planOf(withWalkMinutes(defaultParams(), 'A-33', 20), walking(['A-31', 'A-33']));
    expect(other.nodes.find(node => node.key === 'sa:A-31:0')?.scenario).toBe(false);
    expect(other.nodes.find(node => node.key === 'sa:A-33:0')).toMatchObject({
      detail: '步行 20 分钟 · 1.33 公里',
      scenario: true
    });
  });
});
