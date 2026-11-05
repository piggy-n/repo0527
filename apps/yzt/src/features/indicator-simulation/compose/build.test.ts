// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams, withWalkMinutes } from '../model/params';
import { areaScope, citiesScope } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { indicatorNode, OUTPUT_NODE, paramNode, REGION_NODE, YEAR_PENDING_NODE, yearNode } from './board';
import { blankOf, buildSteps } from './build';
import { type Composition, rememberedScopes, withScope } from './composition';
import { paramConflicts, yearsConflict } from './conflicts';

const target: Composition = {
  conditions: { years: [2026, 2025], scope: citiesScope(['320100', '320500']), indicatorIds: ['A-31', 'A-39'] },
  params: { ...defaultParams(), rule: 'old' }
};

const withCities = (cityCodes: readonly string[]) =>
  buildSteps({ ...target, conditions: { ...target.conditions, scope: citiesScope(cityCodes) } });

describe('buildSteps', () => {
  it('节点一个一个出现：年份、监测范围、指标、所选指标用得上的参数，最后是 AI计算', () => {
    expect(buildSteps(target).map(step => step.node)).toEqual([
      yearNode(2026),
      yearNode(2025),
      REGION_NODE,
      indicatorNode('A-31'),
      indicatorNode('A-39'),
      paramNode('popChange'),
      paramNode('walk'),
      paramNode('rule'),
      paramNode('recognition'),
      OUTPUT_NODE
    ]);
  });

  it('每一步写明 AI 在做的事；参数写明是标准口径还是自定义口径', () => {
    expect(buildSteps(target).map(step => step.message)).toEqual([
      '识别年份：2026 年',
      '识别年份：2025 年',
      '识别范围：南京市、苏州市',
      '识别指标：社区卫生服务设施步行15分钟覆盖率',
      '识别指标：人均公园绿地面积',
      '设置常住人口变化：0%（标准口径）',
      '设置步行时长：标准（标准口径）',
      '设置计算规程：旧规程（自定义口径）',
      '设置覆盖认定：覆盖 ≥ 50%（标准口径）',
      '配置完成，即将开始计算'
    ]);
  });

  it('编排一步一步长出来：参数在第一个参数节点出现时设好，最后一步就是目标', () => {
    const steps = buildSteps(target);
    expect(steps[0]?.composition.conditions).toEqual({ years: [2026], scope: citiesScope([]), indicatorIds: [] });
    expect(steps[2]?.composition.conditions).toEqual({
      years: [2026, 2025],
      scope: citiesScope(['320100', '320500']),
      indicatorIds: []
    });
    expect(steps[4]?.composition.params).toBe(defaultParams());
    expect(steps[5]?.composition.params).toBe(target.params);
    expect(steps.at(-1)?.composition).toMatchObject(target);
  });

  it('全省和多个市的范围说明', () => {
    const all = withCities(JIANGSU_CITIES.map(city => city.code));
    expect(all[2]?.message).toBe('识别范围：全省 13 个市');
    const four = withCities(['320100', '320200', '320300', '320400']);
    expect(four[2]?.message).toBe('识别范围：南京市等 4 个市');
  });
});

describe('自定义范围的配置步骤（ADR 0121）', () => {
  it('开始的空白记着两种范围；监测范围一步写出范围和区县数，最后一步就是目标', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '江宁片区');
    const custom = withScope({ ...target, scopes: { cityCodes: ['320500'], area: null } }, areaScope(area));
    const blank = blankOf(custom);
    expect(blank.conditions).toEqual({ years: [], scope: areaScope(null), indicatorIds: [] });
    // 生效的范围以条件为准：记下的是目标原来选的两个市
    expect(rememberedScopes(blank)).toEqual({ cityCodes: ['320100', '320500'], area: null });
    const steps = buildSteps(custom);
    expect(steps[2]?.message).toBe('识别范围：自定义范围「江宁片区」，涉及 7 个区县');
    expect(steps.at(-1)?.composition).toEqual(custom);
    // 配置成行政区划时，记着的自定义范围不丢
    const cities = withScope(custom, citiesScope(['320100']));
    expect(rememberedScopes(buildSteps(cities).at(-1)?.composition ?? cities).area).toBe(area);
  });
});

describe('buildSteps 的步行时长（ADR 0125）', () => {
  it('改过时长的指标一出现就是改后的名称，参数节点写明改了什么', () => {
    const custom = { ...target, params: withWalkMinutes(defaultParams(), 'A-31', 10) };
    const steps = buildSteps(custom);
    const appear = steps.find(step => step.node === indicatorNode('A-31'));
    expect(appear?.message).toBe('识别指标：社区卫生服务设施步行10分钟覆盖率');
    expect(appear?.composition.params.walkMinutes).toEqual({ 'A-31': 10 });
    expect(steps.find(step => step.node === paramNode('walk'))?.message).toBe(
      '设置步行时长：社区卫生 10 分钟（自定义口径）'
    );
  });
});

describe('buildSteps 待补充、待确认（ADR 0129）', () => {
  const pending: Composition = { ...target, conditions: { ...target.conditions, scope: citiesScope([]) } };

  it('没有范围：范围节点照样出现，写明待补充；最后一步不说即将开始计算', () => {
    const steps = buildSteps(pending);
    expect(steps.find(step => step.node === REGION_NODE)?.message).toBe('未指定监测范围，标记为待补充');
    expect(steps.at(-1)).toMatchObject({ node: OUTPUT_NODE, message: '已配置已知条件' });
    expect(steps.at(-1)?.composition.conditions.indicatorIds).toEqual(['A-31', 'A-39']);
  });

  it('沿用页面上已有的范围时写明沿用', () => {
    expect(buildSteps(target, { keptScope: true }).find(step => step.node === REGION_NODE)?.message).toBe('沿用范围：南京市、苏州市');
  });

  it('有冲突：年份多一个待确认的节点，参数写待确认，不说即将开始计算', () => {
    const noYear: Composition = { ...target, conditions: { ...target.conditions, years: [] } };
    const years = buildSteps(noYear, { conflicts: [yearsConflict([2019], [2026, 2025])] });
    expect(years[0]).toMatchObject({ node: YEAR_PENDING_NODE, message: '年份不可用，标记为待确认' });
    const rule = buildSteps(target, { conflicts: paramConflicts('旧规程和新规程') });
    expect(rule.find(step => step.node === paramNode('rule'))?.message).toBe('设置计算规程：待确认');
    expect(rule.at(-1)?.message).toBe('已配置已知条件');
  });
});
