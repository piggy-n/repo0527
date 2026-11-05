// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, RoutePath, smoothAngle } from './route-path';
import type { RoutePoint } from './scene-content-model';

// 苏州站附近：经度 1 度约 95.2 千米、纬度 1 度约 110.9 千米
const LNG = 120.666;
const LAT = 31.3175;
const east = (meters: number) => meters / 95_200;
const north = (meters: number) => meters / 110_900;

// 往东 10 米，再往北 6 米同时下 4 米（楼梯），再往北 4 米
const PATH: RoutePoint[] = [
  [LNG, LAT, -5.1],
  [LNG + east(10), LAT, -5.1],
  [LNG + east(10), LAT + north(6), -9.1],
  [LNG + east(10), LAT + north(10), -9.1]
];

describe('RoutePath', () => {
  it('总长按三维折线算，楼梯的高差也算', () => {
    const route = new RoutePath(PATH);
    expect(route.total).toBeCloseTo(10 + Math.hypot(6, 4) + 4, 1);
  });

  it('起点：视点在地板上方一个眼高，朝向看前方的点（往东是 90°）', () => {
    const pose = new RoutePath(PATH).pose(0);
    expect(pose.lng).toBeCloseTo(LNG, 9);
    expect(pose.lat).toBeCloseTo(LAT, 9);
    expect(pose.height).toBeCloseTo(-5.1 + EYE_HEIGHT, 6);
    expect(pose.heading).toBeCloseTo(90, 3);
    expect(pose.pitch).toBeCloseTo(0, 3);
  });

  it('走到楼梯上：位置在两点之间，往北下楼时朝向 0°、俯仰向下，不超过 30°', () => {
    const route = new RoutePath(PATH);
    const stair = Math.hypot(6, 4);
    const pose = route.pose(10 + stair / 2);
    expect(pose.lng).toBeCloseTo(LNG + east(10), 7);
    expect(pose.lat).toBeCloseTo(LAT + north(3), 7);
    expect(pose.height).toBeCloseTo(-7.1 + EYE_HEIGHT, 2);
    expect(pose.heading).toBeCloseTo(0, 1);
    expect(pose.pitch).toBeLessThan(-20);
    expect(pose.pitch).toBeGreaterThanOrEqual(-30);
  });

  it('拐弯前提前转向：离拐角 2 米时看着拐过去的楼梯，朝向在两段之间', () => {
    const pose = new RoutePath(PATH).pose(8);
    expect(pose.heading).toBeGreaterThan(30);
    expect(pose.heading).toBeLessThan(70);
    expect(pose.pitch).toBeLessThan(0);
  });

  it('超出两端按两端算；终点看最后一段的方向', () => {
    const route = new RoutePath(PATH);
    const end = route.pose(route.total + 5);
    expect(end.lat).toBeCloseTo(LAT + north(10), 7);
    expect(end.height).toBeCloseTo(-9.1 + EYE_HEIGHT, 6);
    expect(end.heading).toBeCloseTo(0, 1);
    expect(end.pitch).toBe(0);
    expect(route.pose(-3)).toStrictEqual(route.pose(0));
  });

  it('少于两个点时抛错', () => {
    expect(() => new RoutePath([[LNG, LAT, 0]])).toThrow('路线至少要有两个点');
  });
});

describe('smoothAngle', () => {
  it('按时间常数靠近目标；走最短的方向，跨过 0°', () => {
    expect(smoothAngle(0, 90, 0.4, 0.4)).toBeCloseTo(90 * (1 - Math.exp(-1)), 6);
    expect(smoothAngle(350, 10, 100, 0.4)).toBeCloseTo(10, 6);
    const halfway = smoothAngle(350, 10, 0.4 * Math.LN2, 0.4);
    expect(halfway).toBeCloseTo(0, 6);
    expect(smoothAngle(10, 350, 0.4 * Math.LN2, 0.4)).toBeCloseTo(0, 6);
    expect(smoothAngle(30, 60, 1, 0)).toBe(60);
  });
});
