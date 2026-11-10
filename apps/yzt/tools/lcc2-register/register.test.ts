// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Lcc2Index, Vec3 } from './lcc2-data.ts';
import { placementFor, turn } from './placement.ts';
import { gridProjection } from './projection.ts';
import { register, type RegisterOptions } from './register.ts';
import { CORRIDOR_WALK, CORRIDORS, meshPly } from './test-meshes.ts';

const INDEX: Lcc2Index = {
  epsg: 4548,
  offset: [505745.458968483, 3793605.533563799, 59.739105],
  root: { meshFiles: CORRIDORS.map((_, i) => `data/mesh/${i}.ply`) }
};
const MESHES = CORRIDORS.map((mesh, i) => ({ name: `data/mesh/${i}.ply`, bytes: meshPly(mesh) }));
const DEFAULTS: RegisterOptions = { shift: [0, 0, 0], yaw: 0, datum: 0, fit: true };

// 纬度 34° 处 1 度经度、纬度约多少米：比较摆放的经纬度用
const METERS_PER_DEGREE_LNG = 92100;
const METERS_PER_DEGREE_LAT = 110900;

describe('register', () => {
  it('偏航：轨迹相对网格转了 2° 再平移，给出这个偏航时拟合出的修正和摆放都对得上', () => {
    // 网格放到世界里是先转 yaw 再平移 shift，所以轨迹（按 offset 摆放是对的）也是网格系里的轨迹这样变换过的
    const truth = { shift: [12.5, -7.25, 3.4] as Vec3, yaw: 2 };
    const trajectory = CORRIDOR_WALK.map((point): Vec3 => {
      const [x, y, z] = turn(point, truth.yaw);
      return [x + truth.shift[0], y + truth.shift[1], z + truth.shift[2]];
    });
    const result = register({ index: INDEX, trajectory, meshes: MESHES }, { ...DEFAULTS, yaw: truth.yaw });

    expect(Math.abs(result.correction.shift[0] - truth.shift[0])).toBeLessThan(0.25);
    expect(Math.abs(result.correction.shift[1] - truth.shift[1])).toBeLessThan(0.25);
    expect(Math.abs(result.correction.shift[2] - truth.shift[2])).toBeLessThan(0.05);
    expect(result.correction.yaw).toBe(truth.yaw);
    expect(result.check.passed).toBe(true);

    const expected = placementFor(gridProjection(INDEX.epsg), INDEX.offset, truth);
    expect(Math.abs(result.placement.lng - expected.lng) * METERS_PER_DEGREE_LNG).toBeLessThan(0.25);
    expect(Math.abs(result.placement.lat - expected.lat) * METERS_PER_DEGREE_LAT).toBeLessThan(0.25);
    expect(result.placement.height).toBeCloseTo(expected.height, 1);
    // 朝向含子午线收敛角，随原点的位置有微小差别
    expect(result.placement.heading).toBeCloseTo(expected.heading, 4);
  });

  it('人工修正加在拟合的结果上，核对算上它', () => {
    const base = register({ index: INDEX, trajectory: CORRIDOR_WALK, meshes: MESHES }, DEFAULTS);
    const moved = register(
      { index: INDEX, trajectory: CORRIDOR_WALK, meshes: MESHES },
      { ...DEFAULTS, shift: [0.3, -0.2, 0.1] }
    );
    expect(moved.correction.shift[0]).toBeCloseTo(base.fitted[0] + 0.3, 9);
    expect(moved.correction.shift[1]).toBeCloseTo(base.fitted[1] - 0.2, 9);
    expect(moved.correction.shift[2]).toBeCloseTo(base.fitted[2] + 0.1, 9);
    expect(moved.check.inWindow).toBeLessThan(base.check.inWindow);
  });

  it('高程基准的差只加在高度上，核对不变', () => {
    const base = register({ index: INDEX, trajectory: CORRIDOR_WALK, meshes: MESHES }, DEFAULTS);
    const raised = register({ index: INDEX, trajectory: CORRIDOR_WALK, meshes: MESHES }, { ...DEFAULTS, datum: 5.47 });
    expect(raised.placement.height).toBeCloseTo(base.placement.height + 5.47, 9);
    expect(raised.placement.lng).toBe(base.placement.lng);
    expect(raised.check).toEqual(base.check);
    expect(raised.failed).toBe(false);
  });

  it('核对不通过时 failed 为 true', () => {
    const result = register(
      { index: INDEX, trajectory: CORRIDOR_WALK, meshes: MESHES },
      { ...DEFAULTS, shift: [0, 0, 10] }
    );
    expect(result.check.passed).toBe(false);
    expect(result.failed).toBe(true);
  });

  it('不拟合：只用人工修正', () => {
    const result = register(
      { index: INDEX, trajectory: CORRIDOR_WALK, meshes: MESHES },
      { ...DEFAULTS, fit: false, shift: [1, 2, 3] }
    );
    expect(result.fit).toBeNull();
    expect(result.correction.shift).toEqual([1, 2, 3]);
  });

  it('网格文件读不了：报错里有文件名', () => {
    const broken = [{ name: 'data/mesh/bad.ply', bytes: new TextEncoder().encode('hello') }];
    expect(() => register({ index: INDEX, trajectory: CORRIDOR_WALK, meshes: broken }, DEFAULTS)).toThrow(
      'data/mesh/bad.ply：不是 PLY 文件'
    );
  });
});
