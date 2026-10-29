// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  demoTarget,
  INDICATOR_GROUPS,
  reachMeters,
  reachText,
  SIMULATION_INDICATORS,
  simulationIndicator,
  UNKNOWN_SPEC_IDS,
  walkMeters
} from './indicators';

describe('推演支持的指标', () => {
  it('22 项都在共用目录里，四类都有', () => {
    expect(UNKNOWN_SPEC_IDS).toEqual([]);
    expect(SIMULATION_INDICATORS).toHaveLength(22);
    expect(INDICATOR_GROUPS.map(group => [group.name, group.indicators.length])).toEqual([
      ['安全韧性', 3],
      ['创新高效/开放繁荣', 5],
      ['共享幸福', 12],
      ['协调节约', 2]
    ]);
  });

  it('名称、单位取自目录，模型和简称来自清单', () => {
    expect(simulationIndicator('B-65')).toMatchObject({
      name: '公园绿地、广场步行5分钟覆盖率',
      short: '公园绿地覆盖率',
      unit: '%',
      model: 'coverage',
      facility: '公园绿地',
      reach: { kind: 'walk', minutes: 5 },
      base: 'residential',
      ruleChange: false
    });
    expect(simulationIndicator('A-39')).toMatchObject({ unit: 'm²', model: 'perCapita', facility: '公园绿地' });
    expect(() => simulationIndicator('B-12')).toThrow('推演不支持指标 B-12');
  });

  it('覆盖对象和规程变化按计算方法：消防、派出所覆盖城区面积，社区卫生、文化设施有新旧规程', () => {
    const coverage = SIMULATION_INDICATORS.flatMap(item => (item.model === 'coverage' ? [item] : []));

    expect(coverage.filter(item => item.base === 'area').map(item => item.id)).toEqual(['A-15', 'D01-5']);
    expect(coverage.filter(item => item.ruleChange).map(item => item.id)).toEqual(['A-31', 'A-35']);
  });

  it('服务距离：步行按 Excel 的 5、10、15 分钟三档，车行和缓冲区是固定距离，人均类没有', () => {
    expect(['B-65', 'A-32', 'A-31', 'A-15', 'D01-5', 'F03-2'].map(id => reachMeters(simulationIndicator(id)))).toEqual([
      300, 500, 1000, 3000, 3000, 5000
    ]);
    expect(reachMeters(simulationIndicator('A-39'))).toBeNull();
    expect(() => walkMeters(7)).toThrow('没有步行 7 分钟的距离档');
    expect(['A-31', 'A-15', 'B-14', 'A-39'].map(id => reachText(simulationIndicator(id)))).toEqual([
      '步行 15 分钟（1000 米）',
      '车行 5 分钟（3 公里）',
      '2 公里缓冲区',
      '面积 ÷ 人口'
    ]);
  });

  it('目标值是 2026 年城市值的中位数取整', () => {
    expect(['B-65', 'A-31', 'A-39', 'B-61', 'A-14'].map(demoTarget)).toEqual([70, 80, 15, 2.1, 2.1]);
  });
});
