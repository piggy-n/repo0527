// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams } from '../model/params';
import { areaScope, citiesScope } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { indicatorNode, OUTPUT_NODE, paramNode, REGION_NODE, yearNode } from './board';
import { blankOf, buildSteps } from './build';
import { type Composition, rememberedScopes, withScope } from './composition';

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
