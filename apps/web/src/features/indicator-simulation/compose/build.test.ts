// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams } from '../model/params';
import { indicatorNode, OUTPUT_NODE, paramNode, REGION_NODE, yearNode } from './board';
import { buildSteps } from './build';
import type { Composition } from './composition';

const target: Composition = {
  conditions: { years: [2026, 2025], cityCodes: ['320100', '320500'], indicatorIds: ['A-31', 'A-39'] },
  params: { ...defaultParams(), rule: 'old' }
};

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
      paramNode('targets'),
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
      '设置目标值：2 项默认',
      '配置完成，即将开始计算'
    ]);
  });

  it('编排一步一步长出来：参数在第一个参数节点出现时设好，最后一步就是目标', () => {
    const steps = buildSteps(target);
    expect(steps[0]?.composition.conditions).toEqual({ years: [2026], cityCodes: [], indicatorIds: [] });
    expect(steps[2]?.composition.conditions).toEqual({ years: [2026, 2025], cityCodes: ['320100', '320500'], indicatorIds: [] });
    expect(steps[4]?.composition.params).toBe(defaultParams());
    expect(steps[5]?.composition.params).toBe(target.params);
    expect(steps.at(-1)?.composition).toEqual(target);
  });

  it('全省和多个市的范围说明', () => {
    const all = buildSteps({ ...target, conditions: { ...target.conditions, cityCodes: JIANGSU_CITIES.map(city => city.code) } });
    expect(all[2]?.message).toBe('识别范围：全省 13 个市');
    const four = buildSteps({ ...target, conditions: { ...target.conditions, cityCodes: ['320100', '320200', '320300', '320400'] } });
    expect(four[2]?.message).toBe('识别范围：南京市等 4 个市');
  });
});
