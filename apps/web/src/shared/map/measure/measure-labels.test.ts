// @vitest-environment node
import { cumulativeDistances, type LngLat } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { centroid, formatArea, formatDistance, measureHint, measureLabels } from './measure-labels';

const A: LngLat = [118, 32];
const B: LngLat = [118.1, 32];
const C: LngLat = [118.1, 32.1];
const D: LngLat = [118, 32.1];

describe('测量的标签与提示', () => {
  it('距离固定用 km、两位小数', () => {
    expect(formatDistance(1234.5)).toBe('1.23 km');
    expect(formatDistance(56)).toBe('0.06 km');
  });

  it('面积满 1 km² 用 km²，否则用 m²，两位小数', () => {
    expect(formatArea(2_345_678)).toBe('2.35 km²');
    expect(formatArea(1_000_000)).toBe('1.00 km²');
    expect(formatArea(999_999.994)).toBe('999999.99 m²');
  });

  it('形心：矩形的中心；三角形是三个顶点的平均；面积为 0 时取顶点的平均', () => {
    const [lng, lat] = centroid([A, B, C, D]);
    expect(lng).toBeCloseTo(118.05, 10);
    expect(lat).toBeCloseTo(32.05, 10);

    const [triangleLng, triangleLat] = centroid([A, B, C]);
    expect(triangleLng).toBeCloseTo((118 + 118.1 + 118.1) / 3, 10);
    expect(triangleLat).toBeCloseTo((32 + 32 + 32.1) / 3, 10);

    expect(centroid([A, B, [118.2, 32]])).toStrictEqual([118.1, 32]);
  });

  it('测距：中间节点显示累计距离，末点显示总长并带关闭按钮', () => {
    const points = [A, B, C, D];
    const distances = cumulativeDistances(points);

    const labels = measureLabels({
      measurements: [{ id: 'distance-1', kind: 'distance', points, method: 'geodesic', value: 34567 }],
      draft: null
    });

    expect(labels).toStrictEqual([
      { key: 'distance-1-1', lngLat: B, text: formatDistance(distances[1]) },
      { key: 'distance-1-2', lngLat: C, text: formatDistance(distances[2]) },
      { key: 'distance-1-total', lngLat: D, text: '总长 34.57 km', measurementId: 'distance-1' }
    ]);
  });

  it('测面：在形心显示总面积并带关闭按钮', () => {
    const labels = measureLabels({
      measurements: [{ id: 'area-1', kind: 'area', points: [A, B, C, D], method: 'geodesic', value: 1_234_567 }],
      draft: null
    });

    expect(labels).toStrictEqual([
      { key: 'area-1-total', lngLat: centroid([A, B, C, D]), text: '总面积 1.23 km²', measurementId: 'area-1' }
    ]);
  });

  it('正在画的测距显示已确定的中间节点，不带关闭按钮；正在画的测面没有标签', () => {
    const drawingLine = measureLabels({ measurements: [], draft: { kind: 'distance', points: [A, B, C], preview: D } });
    const drawingArea = measureLabels({ measurements: [], draft: { kind: 'area', points: [A, B, C], preview: D } });

    expect(drawingLine).toStrictEqual([
      { key: 'draft-1', lngLat: B, text: formatDistance(cumulativeDistances([A, B, C])[1]) }
    ]);
    expect(drawingArea).toStrictEqual([]);
  });

  it('提示沿用旧项目的文案', () => {
    expect(measureHint('distance', false)).toBe('单击开始测距');
    expect(measureHint('distance', true)).toBe('单击添加节点，双击结束测距');
    expect(measureHint('area', false)).toBe('单击开始测面');
    expect(measureHint('area', true)).toBe('单击添加节点，双击结束测面');
  });
});
