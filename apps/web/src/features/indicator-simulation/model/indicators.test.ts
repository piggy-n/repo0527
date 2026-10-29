// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  demoTarget,
  INDICATOR_GROUPS,
  isWalkCoverage,
  reachMeters,
  reachText,
  SIMULATION_INDICATORS,
  simulationIndicator,
  UNKNOWN_SPEC_IDS
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
      reach: { kind: 'walk', minutes: 5 }
    });
    expect(simulationIndicator('A-39')).toMatchObject({ unit: 'm²', model: 'perCapita', facility: '公园绿地' });
    expect(() => simulationIndicator('B-12')).toThrow('推演不支持指标 B-12');
  });

  it('服务半径：步行类随步行速度变化，固定距离类不变，人均类没有', () => {
    expect(reachMeters(simulationIndicator('A-31'), 60)).toBe(900);
    expect(reachMeters(simulationIndicator('A-31'), 80)).toBe(1200);
    expect(reachMeters(simulationIndicator('F03-2'), 80)).toBe(5000);
    expect(reachMeters(simulationIndicator('A-39'), 60)).toBeNull();
    expect(isWalkCoverage(simulationIndicator('A-31'))).toBe(true);
    expect(isWalkCoverage(simulationIndicator('B-14'))).toBe(false);
    expect(['A-31', 'A-15', 'B-14', 'A-39'].map(id => reachText(simulationIndicator(id)))).toEqual([
      '步行 15 分钟',
      '2.5 公里半径',
      '2 公里半径',
      '面积 ÷ 人口'
    ]);
  });

  it('演示目标值是 2026 年城市值的中位数取整', () => {
    expect(['B-65', 'A-31', 'A-39', 'B-61', 'A-14'].map(demoTarget)).toEqual([70, 80, 15, 2.1, 2.1]);
  });
});
