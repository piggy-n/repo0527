// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGION_PALETTE,
  levelLegend,
  localToPlane,
  MINOR_REGION_COLOR,
  OBSTACLE_COLOR,
  planeBounds,
  planeToLocal,
  planRegions,
  regionColorAt,
  renderFloorMap
} from './floor-map';
import { buildNavGrid } from './heightfield';
import { detectLevels, levelBounds, levelOf, nearestOnLevel, nodeOnLevel } from './levels';
import { NavGrid } from './nav-grid';
import { twoLevelStation } from './nav-testing';
import { labelRegions } from './regions';

const grid = new NavGrid(labelRegions(buildNavGrid([twoLevelStation()])));
const levels = detectLevels(grid, { groundHeight: 0 });
const [upper, lower] = levels;

// 取 1 像素：正北朝上的平面里 (east, north) 那一点的颜色
function pixel(level: (typeof levels)[number], east: number, north: number, bearing = 0) {
  const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  renderFloorMap(grid, planRegions(grid, levels), level, image, {
    left: east - 0.05,
    top: north + 0.05,
    res: 0.1,
    north: bearing
  });
  return Array.from(image.data);
}

describe('detectLevels', () => {
  it('两片地面高差 5 米分成两层，楼梯不单独成层；地下从上往下 -1F、-2F，高度范围在中点相接', () => {
    expect(levels.map(({ name, height, elevation }) => [name, height, elevation])).toStrictEqual([
      ['-1F', -5, -5],
      ['-2F', -10, -10]
    ]);
    expect([upper.from, upper.to, lower.from, lower.to]).toStrictEqual([-7.5, Infinity, -Infinity, -7.5]);
    expect(levelOf(levels, -6)?.name).toBe('-1F');
    expect(levelOf(levels, -9)?.name).toBe('-2F');
  });

  it('场景配置的楼层名按高度匹配；不知道地面高度时从上往下叫"楼层 1、2"', () => {
    expect(detectLevels(grid, { groundHeight: 0, names: [{ name: '站厅', height: -5.2 }] })[0].name).toBe('站厅');
    expect(detectLevels(grid).map(({ name }) => name)).toStrictEqual(['楼层 1', '楼层 2']);
    expect(detectLevels(grid, { groundHeight: -12 }).map(({ name }) => name)).toStrictEqual(['2F', '1F']);
  });

  it('某格在某层上的节点：楼梯下半截归下层、上半截归上层；最近的能站位置与这一层的范围', () => {
    const [sx, low] = grid.cellOf(9, 13) ?? [0, 0];
    const [, high] = grid.cellOf(9, 16) ?? [0, 0];
    expect(nodeOnLevel(grid, sx, low, lower)).not.toBe(-1);
    expect(nodeOnLevel(grid, sx, low, upper)).toBe(-1);
    expect(nodeOnLevel(grid, sx, high, upper)).not.toBe(-1);
    const near = nearestOnLevel(grid, upper, 21, 20, 2);
    expect(near?.floor).toBe(-5);
    expect(nearestOnLevel(grid, upper, 21, 5, 2)).toBeNull();
    const bounds = levelBounds(grid, upper);
    expect(bounds && [bounds.minY <= 17, bounds.maxY >= 29, bounds.maxX >= 32]).toStrictEqual([true, true, true]);
  });
});

describe('按区域着色的平面图', () => {
  it('面积大的区域先分颜色，同一层的区域颜色不同；跨两层的区域同一色相、按高度渐变；小区域是中性色', () => {
    const plan = planRegions(grid, levels);
    const [main, room, small] = levelLegend(plan, upper)
      .map(({ region }) => region)
      .concat(levelLegend(plan, lower).map(({ region }) => region))
      .filter((region, index, all) => all.indexOf(region) === index);
    expect(main.color).toBe(DEFAULT_REGION_PALETTE[0]);
    expect([main.zMin, main.zMax]).toStrictEqual([-10, -5]);
    expect(room.color).toBe(DEFAULT_REGION_PALETTE[1]);
    expect(small.color).toBeNull();
    expect(regionColorAt(main, -10)).toStrictEqual(DEFAULT_REGION_PALETTE[0].low);
    expect(regionColorAt(main, -5)).toStrictEqual(DEFAULT_REGION_PALETTE[0].high);
    expect(regionColorAt(small, -10)).toStrictEqual(MINOR_REGION_COLOR);
  });

  it('图例按这一层的面积从大到小', () => {
    const legend = levelLegend(planRegions(grid, levels), upper);
    expect(legend).toHaveLength(2);
    expect(legend[0].area).toBeGreaterThan(200);
    expect(legend[1].area).toBeGreaterThan(90);
    expect(legend[1].area).toBeLessThan(120);
  });

  it('画出的像素：区域按颜色、贴边站不下的是灰色、没有地板的透明', () => {
    expect(pixel(upper, 10, 22)).toStrictEqual([...DEFAULT_REGION_PALETTE[0].high, 255]);
    expect(pixel(upper, 27, 22)).toStrictEqual([...DEFAULT_REGION_PALETTE[1].low, 255]);
    expect(pixel(lower, 25, 6)).toStrictEqual([...MINOR_REGION_COLOR, 255]);
    expect(pixel(upper, 0.1, 22)).toStrictEqual([...OBSTACLE_COLOR, 255]);
    expect(pixel(upper, 21, 22)[3]).toBe(0);
    expect(pixel(upper, 10, 6)[3]).toBe(0);
  });

  it('局部 y 轴偏东 90° 时按方位角旋转，正北仍然朝上', () => {
    const [east, north] = localToPlane(10, 22, 90);
    expect([east, north].map(value => Math.round(value))).toStrictEqual([22, -10]);
    expect(planeToLocal(east, north, 90).map(value => Math.round(value))).toStrictEqual([10, 22]);
    expect(pixel(upper, 22, -10, 90)).toStrictEqual([...DEFAULT_REGION_PALETTE[0].high, 255]);
    expect(pixel(upper, 22, -10, 0)[3]).toBe(0);
    const { left, right, bottom, top } = planeBounds({ minX: 0, minY: 0, maxX: 10, maxY: 4 }, 90);
    expect([left, right, bottom, top].map(value => Math.round(value) + 0)).toStrictEqual([0, 4, -10, 0]);
  });
});
