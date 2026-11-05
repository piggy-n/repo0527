import { decimalPlaces, formatValue } from '../calculations';
import { getMapClassIndex, type MapClassification } from '../map-classification';
import type { Indicator } from '../model';

export const MAP_DEPTH = 14;
export const MAP_COLORS = ['#B4E2FD', '#56C3FB', '#2EA7F6', '#168CF2', '#075BE7'];
export const EMPTY_COLOR = '#E5EDF3';
export const MAP_ENTRANCE = { color: '#7BCBF4', boundaryColor: '#267BB6', colorDuration: 0.85, valueDuration: 1.1 };
export const MAP_YEAR_TRANSITION = { duration: 0.72, ease: 'power2.out' };

/** 不同档数均覆盖完整色板，三维、二维和图例使用相同颜色；只有一档时取色板中间 */
export function colorCoordinate(value: number | null, classification: MapClassification): number | null {
  const index = getMapClassIndex(value, classification);
  if (index === null) {
    return null;
  }
  return classification.classCount === 1 ? 50 : index / (classification.classCount - 1) * 100;
}

export function getMapColor(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return EMPTY_COLOR;
  }
  return MAP_COLORS[Math.max(0, Math.min(4, Math.floor(value / 100 * 5)))];
}

/** 地图图例的一档 */
export interface MapLegendLevel {
  readonly color: string;
  readonly label: string;
}

/** 地图图例：从高到低每档一行，分界统一按其中最多的小数位显示（至多 20 位） */
export function mapLegendLevels(classification: MapClassification, indicator: Indicator): MapLegendLevel[] {
  const { classCount, displayMin, displayMax, breaks } = classification;
  // 有分档就有观测值，显示范围一定有值
  if (!classCount || displayMin === null || displayMax === null) {
    return [];
  }
  const boundaries = [displayMin, ...breaks];
  const precision = Math.min(20, Math.max(...[...boundaries, displayMax].map(decimalPlaces)));
  const format = (value: number) => formatValue(value, indicator, indicator.unit === '%', precision);
  return boundaries
    .map((min, index) => {
      const max = breaks[index] ?? displayMax;
      const upperBound = `${index < boundaries.length - 1 ? '<' : ''}${format(max)}`;
      return {
        color: getMapColor(colorCoordinate(min, classification)),
        label: min === max ? format(min) : `${format(min)} ~ ${upperBound}`
      };
    })
    .toReversed();
}
