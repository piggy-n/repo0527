// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkTrajectory } from './check.ts';
import { buildFloorGrid } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';
import { rectangle } from './test-meshes.ts';

// 地面一层在 0，地下一层在 -5（x 0～10）
const GRID = buildFloorGrid([rectangle(0, 0, 20, 10, 0), rectangle(0, 0, 10, 10, -5)]);

const line = (count: number, z: number, x0 = 1): Vec3[] =>
  Array.from({ length: count }, (_, index): Vec3 => [x0 + index * 0.1, 5, z]);

describe('checkTrajectory', () => {
  it('手持的高度：通过，中位数和分布', () => {
    const check = checkTrajectory([...line(90, 1.25), ...line(10, 0.5)], GRID);
    expect(check).toMatchObject({ sampled: 100, withFloor: 100, inWindow: 90, passed: true });
    expect(check.median).toBeCloseTo(1.25);
    expect(check.histogram.find((bin) => bin.from === 1.25)?.count).toBe(90);
    expect(check.histogram.find((bin) => bin.from === 0.5)?.count).toBe(10);
  });

  it('每个点和自己脚下的那层比：地下的轨迹按地下的地面算', () => {
    const check = checkTrajectory(line(50, -3.8), GRID);
    expect(check.inWindow).toBe(50);
    expect(check.passed).toBe(true);
  });

  it('高出 2 米：不通过；超过 3 米的算在最后一档', () => {
    expect(checkTrajectory(line(100, 2), GRID).passed).toBe(false);
    const high = checkTrajectory(line(10, 8), GRID);
    expect(high.histogram.at(-1)).toEqual({ from: 3, count: 10 });
  });

  it('脚下没有表面的点也算在分母里', () => {
    const check = checkTrajectory([...line(75, 1.25), ...line(25, 1.25, 30)], GRID);
    expect(check).toMatchObject({ sampled: 100, withFloor: 75, inWindow: 75, passed: false });
  });

  it('没有点：不通过', () => {
    expect(checkTrajectory([], GRID)).toMatchObject({ sampled: 0, median: undefined, passed: false });
  });
});
