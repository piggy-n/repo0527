// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { INDICATORS } from '../catalog';
import { createMapClassification } from '../map-classification';
import type { Indicator } from '../model';
import { colorCoordinate, EMPTY_COLOR, getMapColor, mapLegendLevels, MAP_COLORS } from './config';

function indicator(id: string): Indicator {
  const found = INDICATORS.find(item => item.id === id);
  if (!found) {
    throw new Error(`指标目录里没有 ${id}`);
  }
  return found;
}

describe('地图分档的颜色与图例', () => {
  it('图例从高到低每档一行，最高一档包含上界；百分比带单位', () => {
    const levels = mapLegendLevels(createMapClassification([0, 0, 10, 10, 20, 30, 40]), indicator('A-15'));

    expect(levels.map(level => level.label)).toEqual(['40%', '30% ~ <40%', '20% ~ <30%', '10% ~ <20%', '0% ~ <10%']);
    expect(levels.map(level => level.color)).toEqual(MAP_COLORS.toReversed());
  });

  it('分界按最多的小数位统一显示；数量不带单位、加千分位', () => {
    const levels = mapLegendLevels(createMapClassification([3, 120, 455, 1000, 1200]), indicator('B-12'));

    expect(levels.map(level => level.label)).toEqual([
      '1,200 ~ 1,500',
      '1,000 ~ <1,200',
      '200 ~ <1,000',
      '100 ~ <200',
      '0 ~ <100'
    ]);
  });

  it('只有一档时取色板中间，没有观测值时没有图例、颜色为空', () => {
    const single = createMapClassification([1.25, 1.25]);

    expect(mapLegendLevels(single, indicator('A-15'))).toEqual([{ color: MAP_COLORS[2], label: '1.25%' }]);
    expect(colorCoordinate(1.25, single)).toBe(50);
    expect(mapLegendLevels(createMapClassification([null]), indicator('A-15'))).toEqual([]);
    expect(getMapColor(colorCoordinate(null, single))).toBe(EMPTY_COLOR);
  });
});
