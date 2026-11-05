// @vitest-environment node
import { type RoutePoint, RoutePath } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { indoorMapOf, type MapPlayer, toPlane } from './indoor-map';
import { twoLevelNavigation } from './indoor-map-testing';
import { routePlayer, trackOnLevel, trackPoints } from './route-track';

// 局部系里的路线：在 -5 米的西半边往东走 16 米，下到东半边的 -10 米，再往东走 6 米
const LOCAL: readonly [number, number, number][] = [
  [2, 6, -5],
  [10, 6, -5],
  [18, 6, -5],
  [24, 6, -10],
  [30, 6, -10]
];

function setup(north = 0) {
  const navigation = twoLevelNavigation(north);
  const map = indoorMapOf(navigation);
  const path: RoutePoint[] = LOCAL.map(point => {
    const [lng, lat, height] = navigation.frame.toLngLat(point);
    return [lng, lat, height];
  });
  return { navigation, map, path, levels: map.levels };
}

const player = (x: number, y: number, floor: number): MapPlayer => ({ x, y, floor, yaw: 0, hfov: 1, target: null });

// 经纬度来回换算有微小的误差，比较到毫米
const rounded = (lines: readonly (readonly (readonly [number, number])[])[]) =>
  lines.map(line => line.map(([east, north]) => [Number(east.toFixed(3)), Number(north.toFixed(3))]));

describe('trackPoints', () => {
  it('路线换到导航网格的局部系，带累计的三维长度', () => {
    const { navigation, path } = setup(30);

    const points = trackPoints(navigation.frame, path);

    points.forEach((point, index) => {
      const [x, y, floor] = required(LOCAL[index], '没有这个点');
      expect([point.x, point.y, point.floor].map(value => Number(value.toFixed(3)))).toStrictEqual([x, y, floor]);
    });
    expect(points.map(point => Number(point.distance.toFixed(3)))).toStrictEqual([
      0,
      8,
      16,
      Number((16 + Math.hypot(6, 5)).toFixed(3)),
      Number((22 + Math.hypot(6, 5)).toFixed(3))
    ]);
  });
});

describe('routePlayer', () => {
  it.each([0, 30])('人按走过的米数在路线上，朝向沿路线（局部 y 轴方位角 %s°）：往局部 +x 走时偏航是 90°', north => {
    const { navigation, path } = setup(north);
    const route = new RoutePath(path);

    const start = routePlayer(navigation.frame, route, 0);
    expect([start.x, start.y, start.floor].map(value => Number(value.toFixed(2)))).toStrictEqual([2, 6, -5]);
    expect(start.yaw).toBeCloseTo(Math.PI / 2, 2);
    expect(start.target).toBeNull();

    const middle = routePlayer(navigation.frame, route, 12);
    expect([middle.x, middle.y, middle.floor].map(value => Number(value.toFixed(2)))).toStrictEqual([14, 6, -5]);
  });
});

describe('trackOnLevel', () => {
  it('每一层只画落在这一层上的连续的点；走过的一段到人所在的位置为止，人在别的楼层时到走过的米数为止', () => {
    const { navigation, map, path, levels } = setup();
    const [upper, lower] = levels;
    const track = { points: trackPoints(navigation.frame, path), walked: 9 };
    const plane = (x: number, y: number) => toPlane(map, x, y).map(value => Number(value.toFixed(3)));

    const onUpper = trackOnLevel(map, required(upper, '没有上层'), track, player(11, 6, -5));
    expect(rounded(onUpper.all)).toStrictEqual([[plane(2, 6), plane(10, 6), plane(18, 6)]]);
    expect(rounded(onUpper.passed)).toStrictEqual([[plane(2, 6), plane(10, 6), plane(11, 6)]]);

    const onLower = trackOnLevel(map, required(lower, '没有下层'), track, null);
    expect(rounded(onLower.all)).toStrictEqual([[plane(24, 6), plane(30, 6)]]);
    expect(onLower.passed).toStrictEqual([]);
  });
});
