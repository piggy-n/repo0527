// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  indoorMapOf,
  levelRaster,
  type MapPlayer,
  minimapRaster,
  minimapStale,
  pickOnLevel,
  planeHeading,
  type PlaneRaster,
  playerLevel,
  toPlane
} from './indoor-map';
import { twoLevelNavigation } from './indoor-map-testing';

const navigation = twoLevelNavigation();
const map = indoorMapOf(navigation);
const [upper, lower] = map.levels;

const player = (extra: Partial<MapPlayer> = {}): MapPlayer => ({
  x: 5,
  y: 6,
  floor: -5,
  yaw: 0,
  hfov: 1.5,
  target: null,
  ...extra
});

// 平面里 (east, north) 处的像素有没有画上颜色；不在这块图里时抛错
function painted(raster: PlaneRaster, east: number, north: number): boolean {
  const col = Math.floor((east - raster.left) / raster.res);
  const row = Math.floor((raster.top - north) / raster.res);
  if (col < 0 || row < 0 || col >= raster.image.width || row >= raster.image.height) {
    throw new Error(`(${east}, ${north}) 不在底图里`);
  }
  return raster.image.data[(row * raster.image.width + col) * 4 + 3] === 255;
}

describe('indoorMapOf', () => {
  it('按地面高度分出 -1F、-2F，按导航网格缓存', () => {
    expect(map.levels.map(({ name, height }) => [name, height])).toStrictEqual([
      ['-1F', -5],
      ['-2F', -10]
    ]);
    expect(indoorMapOf(navigation)).toBe(map);
    expect(indoorMapOf(twoLevelNavigation())).not.toBe(map);
  });

  it('人所在的楼层按脚下的地板；局部系按 north 换到正北朝上的平面', () => {
    expect(playerLevel(map, player())?.name).toBe('-1F');
    expect(playerLevel(map, player({ floor: -10 }))?.name).toBe('-2F');
    const turned = indoorMapOf(twoLevelNavigation(90));
    // 局部 y 轴朝东：局部的 (5, 6) 在平面里是东 6、北 -5，偏航 0 的人面朝正东
    expect(toPlane(turned, 5, 6).map(value => Number(value.toFixed(9)) + 0)).toStrictEqual([6, -5]);
    expect(planeHeading(turned, player())).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('levelRaster', () => {
  it('整层的底图只画这一层的地面，四周留白；按楼层缓存', () => {
    const raster = levelRaster(map, upper ?? map.levels[0]);
    if (!raster) {
      throw new Error('-1F 应该有底图');
    }
    // 范围按分块粗算，东半边靠西的一段也在图里，但没有这一层的地面
    expect(painted(raster, 5, 6)).toBe(true);
    expect(painted(raster, 22, 6)).toBe(false);
    expect(raster.left).toBeLessThan(-5);
    expect(raster.res).toBeCloseTo(0.2, 9);
    expect(levelRaster(map, upper ?? map.levels[0])).toBe(raster);

    const below = levelRaster(map, lower ?? map.levels[0]);
    expect(below && painted(below, 30, 6)).toBe(true);
    expect(below && painted(below, 17, 6)).toBe(false);
  });
});

describe('小地图', () => {
  it('底图以人为中心，边长是显示范围的 1.5 倍；放大时 0.2 米一像素，缩小时最多 128 像素一个显示范围', () => {
    const near = minimapRaster(map, upper ?? map.levels[0], [5, 6], 20);
    expect(near.image.width).toBe(150);
    expect([near.left, near.top]).toStrictEqual([-10, 21]);
    expect(painted(near, 5, 6)).toBe(true);
    expect(painted(near, 3, 13)).toBe(false);
    const far = minimapRaster(map, upper ?? map.levels[0], [5, 6], 160);
    expect(far.image.width).toBe(192);
    expect(far.res).toBeCloseTo(1.25, 9);
  });

  it('换了楼层、显示范围，或者人走出显示范围的 1/5 才重新采样', () => {
    const level = upper ?? map.levels[0];
    const sampled = { level: level.index, range: 40, center: [5, 6] as const };
    expect(minimapStale(null, level, 40, [5, 6])).toBe(true);
    expect(minimapStale(sampled, level, 40, [12, 6])).toBe(false);
    expect(minimapStale(sampled, level, 40, [14, 6])).toBe(true);
    expect(minimapStale(sampled, level, 80, [5, 6])).toBe(true);
    expect(minimapStale(sampled, lower ?? level, 40, [5, 6])).toBe(true);
  });
});

describe('pickOnLevel', () => {
  it('双击处能站就是那一格；在别的楼层的地面上时找这一层最近的；30 米内没有时为 null', () => {
    const level = upper ?? map.levels[0];
    const spot = pickOnLevel(map, level, 5.05, 6.05);
    expect(spot?.x).toBeCloseTo(5.1, 9);
    expect(spot?.y).toBeCloseTo(6.1, 9);
    expect(spot?.floor).toBe(-5);
    const edge = pickOnLevel(map, level, 25, 6);
    expect(edge?.floor).toBe(-5);
    expect(edge?.x).toBeCloseTo(19.1, 9);
    expect(pickOnLevel(map, level, 80, 6)).toBeNull();
  });
});
