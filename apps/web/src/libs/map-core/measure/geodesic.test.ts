// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cumulativeDistances, geodesicArea, geodesicDistance, lineLength } from './geodesic';

// WGS84 椭球上的已知值：赤道上 1° 经度的弧长、赤道到北纬 1° 的子午线弧长（单位：米）
const EQUATOR_DEGREE = 111319.4908;
const MERIDIAN_DEGREE = 110574.3886;

describe('椭球面计算', () => {
  it('距离：赤道上 1° 经度、子午线上从赤道到北纬 1°', () => {
    expect(geodesicDistance([0, 0], [1, 0])).toBeCloseTo(EQUATOR_DEGREE, 3);
    expect(geodesicDistance([0, 0], [0, 1])).toBeCloseTo(MERIDIAN_DEGREE, 3);
  });

  it('距离的参数是先经度后纬度', () => {
    // 南京附近沿纬线 1° 比沿经线 1° 短得多：纬线圈随纬度缩小
    const alongParallel = geodesicDistance([118, 32], [119, 32]);
    const alongMeridian = geodesicDistance([118, 32], [118, 33]);

    expect(alongParallel).toBeLessThan(alongMeridian * 0.9);
  });

  it('累计距离：第一个是 0，之后逐段相加', () => {
    const distances = cumulativeDistances([
      [0, 0],
      [1, 0],
      [1, 1]
    ]);

    expect(distances[0]).toBe(0);
    expect(distances[1]).toBeCloseTo(EQUATOR_DEGREE, 3);
    expect(distances[2]).toBeCloseTo(distances[1] + geodesicDistance([1, 0], [1, 1]), 6);
    expect(cumulativeDistances([])).toStrictEqual([]);
  });

  it('总长等于最后一个累计距离；少于两个点时是 0', () => {
    const points: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1]
    ];

    expect(lineLength(points)).toBeCloseTo(cumulativeDistances(points)[2], 6);
    expect(lineLength([[0, 0]])).toBe(0);
  });

  it('面积：顺时针、逆时针相同，约等于两边长的乘积', () => {
    const counterClockwise: [number, number][] = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01]
    ];
    const area = geodesicArea(counterClockwise);

    expect(area).toBeCloseTo(geodesicArea(counterClockwise.toReversed()), 6);
    // 0.01° 见方的小块，近似为平面矩形
    expect(area / ((EQUATOR_DEGREE / 100) * (MERIDIAN_DEGREE / 100))).toBeCloseTo(1, 4);
  });

  it('面积的参数是先经度后纬度：江苏纬度上长宽不等的小块，约等于两条边长的乘积', () => {
    const area = geodesicArea([
      [118, 32],
      [118.02, 32],
      [118.02, 32.01],
      [118, 32.01]
    ]);
    const width = geodesicDistance([118, 32], [118.02, 32]);
    const height = geodesicDistance([118, 32], [118, 32.01]);

    expect(area / (width * height)).toBeCloseTo(1, 3);
  });
});
