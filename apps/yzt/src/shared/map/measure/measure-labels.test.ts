// @vitest-environment node
import { cumulativeDistances, geodesicArea, type LngLat, lineLength } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import {
  centroid,
  formatArea,
  formatDistance,
  LABEL_FLIP_DISTANCE,
  labelSide,
  measureHint,
  measureLabels
} from './measure-labels';

const A: LngLat = [118, 32];
const B: LngLat = [118.1, 32];
const C: LngLat = [118.1, 32.1];
const D: LngLat = [118, 32.1];

describe('测量的标签与提示', () => {
  it('距离不到 1 km 用米、取整，满 1 km 用 km、两位小数；按取整后的米数判断', () => {
    expect(formatDistance(56.4)).toBe('56 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(999.5)).toBe('1.00 km');
    expect(formatDistance(1234.5)).toBe('1.23 km');
  });

  it('面积不到 1 km² 用 m²、取整加千分位，满 1 km² 用 km²、两位小数；按取整后的数值判断', () => {
    expect(formatArea(12.3)).toBe('12 m²');
    expect(formatArea(981_323.07)).toBe('981,323 m²');
    expect(formatArea(999_999.4)).toBe('999,999 m²');
    expect(formatArea(999_999.5)).toBe('1.00 km²');
    expect(formatArea(2_345_678)).toBe('2.35 km²');
  });

  it('节点离画布右边不到 160 像素时，标签放到左边；还不知道画布宽度时放右边', () => {
    expect(labelSide(800 - LABEL_FLIP_DISTANCE, 800)).toBe('right');
    expect(labelSide(800 - LABEL_FLIP_DISTANCE + 1, 800)).toBe('left');
    expect(labelSide(10, 0)).toBe('right');
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
      { key: 'distance-1-total', lngLat: D, caption: '总长', text: '34.57 km', measurementId: 'distance-1' }
    ]);
  });

  it('测面：在形心正中显示总面积并带关闭按钮', () => {
    const labels = measureLabels({
      measurements: [{ id: 'area-1', kind: 'area', points: [A, B, C, D], method: 'geodesic', value: 1_234_567 }],
      draft: null
    });

    expect(labels).toStrictEqual([
      {
        key: 'area-1-total',
        lngLat: centroid([A, B, C, D]),
        caption: '总面积',
        text: '1.23 km²',
        centered: true,
        measurementId: 'area-1'
      }
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

  it('提示：没在画时说明怎么开始；正在画的不是这一种时也一样', () => {
    expect(measureHint('distance', null)).toStrictEqual({ value: null, text: '单击开始测距' });
    expect(measureHint('area', null)).toStrictEqual({ value: null, text: '单击开始测面' });
    expect(measureHint('area', { kind: 'distance', points: [A], preview: B })).toStrictEqual({
      value: null,
      text: '单击开始测面'
    });
  });

  it('提示：画的过程中第一行是含鼠标所在点的长度、面积，点不够时没有', () => {
    const text = '单击添加节点，双击结束，Esc 取消';

    expect(measureHint('distance', { kind: 'distance', points: [A], preview: null })).toStrictEqual({
      value: null,
      text
    });
    expect(measureHint('distance', { kind: 'distance', points: [A, B], preview: C })).toStrictEqual({
      value: `总长 ${formatDistance(lineLength([A, B, C]))}`,
      text
    });
    expect(measureHint('area', { kind: 'area', points: [A], preview: B })).toStrictEqual({ value: null, text });
    expect(measureHint('area', { kind: 'area', points: [A, B], preview: C })).toStrictEqual({
      value: `总面积 ${formatArea(geodesicArea([A, B, C]))}`,
      text
    });
    expect(measureHint('area', { kind: 'area', points: [A, B, C], preview: null }).value).toBe(
      `总面积 ${formatArea(geodesicArea([A, B, C]))}`
    );
  });
});
