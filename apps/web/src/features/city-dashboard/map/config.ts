import { getMapClassIndex, type MapClassification } from '../map-classification';

export const MAP_DEPTH = 14;
export const MAP_COLORS = ['#B4E2FD', '#56C3FB', '#2EA7F6', '#168CF2', '#075BE7'];
export const EMPTY_COLOR = '#E5EDF3';
export const MAP_ENTRANCE = { color: '#7BCBF4', boundaryColor: '#267BB6', colorDuration: .85, valueDuration: 1.1 };
export const MAP_YEAR_TRANSITION = { duration: .72, ease: 'power2.out' };

/** 不同档数均覆盖完整色板，三维、二维和图例使用相同颜色 */
export function colorCoordinate(value: number | null, classification: MapClassification): number | null {
  const index = getMapClassIndex(value, classification);
  return index === null ? null : classification.classCount === 1 ? 50 : index / (classification.classCount - 1) * 100;
}

export function getMapColor(value: number | null): string {
  if (value === null || !Number.isFinite(value)) { return EMPTY_COLOR; }
  return MAP_COLORS[Math.max(0, Math.min(4, Math.floor(value / 100 * 5)))];
}
