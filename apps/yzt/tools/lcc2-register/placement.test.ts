// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Vec3 } from './lcc2-data.ts';
import {
  correctionFromFit,
  NO_CORRECTION,
  placementFor,
  roundPlacement,
  trajectoryToMesh
} from './placement.ts';
import { gridProjection } from './projection.ts';

const PROJECTION = gridProjection(4548);
const OFFSET: Vec3 = [505745.458968483, 3793605.533563799, 59.739105];

describe('placementFor', () => {
  it('不修正：offset 原样换算', () => {
    const placement = roundPlacement(placementFor(PROJECTION, OFFSET, NO_CORRECTION));
    expect(placement).toEqual({ lng: 117.0623886, lat: 34.2699335, height: 59.74, heading: -0.035 });
  });

  it('平移：原点在网格上挪动，高度加上竖直平移和高程基准的差', () => {
    const base = placementFor(PROJECTION, OFFSET, NO_CORRECTION);
    const moved = placementFor(PROJECTION, OFFSET, { shift: [0, 100, 2], yaw: 0 }, 5);
    // 网格北向 100 米：纬度约多 100 / 110900 度，经度因为收敛角稍微变一点
    expect(moved.lat - base.lat).toBeCloseTo(100 / 110900, 5);
    expect(Math.abs(moved.lng - base.lng)).toBeLessThan(1e-6);
    expect(moved.height).toBeCloseTo(base.height + 7, 9);
  });

  it('偏航加在朝向上', () => {
    const base = placementFor(PROJECTION, OFFSET, NO_CORRECTION);
    const turned = placementFor(PROJECTION, OFFSET, { shift: [0, 0, 0], yaw: 1.5 });
    expect(turned.heading - base.heading).toBeCloseTo(1.5, 9);
  });
});

describe('trajectoryToMesh', () => {
  it('是修正的逆变换：网格上的点按修正摆放后回到轨迹上的位置', () => {
    const correction = { shift: [-15, 83, 24] as Vec3, yaw: 30 };
    const meshPoint = trajectoryToMesh([10, 5, 1], correction);
    const angle = (correction.yaw * Math.PI) / 180;
    const [x, y, z] = meshPoint;
    const placed = [
      Math.cos(angle) * x - Math.sin(angle) * y + correction.shift[0],
      Math.sin(angle) * x + Math.cos(angle) * y + correction.shift[1],
      z + correction.shift[2]
    ];
    expect(placed[0]).toBeCloseTo(10, 9);
    expect(placed[1]).toBeCloseTo(5, 9);
    expect(placed[2]).toBeCloseTo(1, 9);
  });

  it('逆时针转 90°：轨迹上东边 1 米的点在网格的南边', () => {
    const [x, y] = trajectoryToMesh([1, 0, 0], { shift: [0, 0, 0], yaw: 90 });
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(-1, 9);
  });
});

describe('correctionFromFit', () => {
  it('方向相反：轨迹往网格挪的反过来就是网格往轨迹挪', () => {
    expect(correctionFromFit([15.3, -83.2, -24.1])).toEqual([-15.3, 83.2, 24.1]);
  });
});
