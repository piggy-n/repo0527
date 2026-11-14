// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RoutePath } from './route-path';
import { RouteTimeline, routeAdvance, routeTurn } from './route-play';

// 局部的米（东、北）换成 [经度, 纬度, 地板]：原点在 [120, 31]，几十米内误差可以忽略
const at = (east: number, north: number): [number, number, number] => [
  120 + east / (111320 * Math.cos((31 * Math.PI) / 180)),
  31 + north / 110900,
  0
];

describe('路线漫游的推进（ADR 0156 R.5）', () => {
  it('朝着路线的方向按速度走；偏 45° 以上只走 15%', () => {
    const path = new RoutePath([at(0, 0), at(20, 0)]);
    const east = path.pose(0).heading;
    expect(routeAdvance(path, 0, east, 0.1, 4)).toBeCloseTo(0.4, 6);
    expect(routeAdvance(path, 0, (east + 90) % 360, 0.1, 4)).toBeCloseTo(0.06, 6);
    // 到终点为止
    expect(routeAdvance(path, path.total - 0.1, east, 1, 4)).toBe(path.total);
  });

  it('转头每秒最多 60°', () => {
    const path = new RoutePath([at(0, 0), at(20, 0)]);
    const pose = path.pose(0);
    const turned = routeTurn(pose, (pose.heading + 180) % 360, 0, 0.1);
    expect(Math.abs(((((turned.heading - pose.heading) % 360) + 540) % 360) - 180)).toBeCloseTo(174, 6);
  });
});

describe('RouteTimeline（ADR 0156 R.5，补充 ADR 0083 的"剩余时间按长度和速度算"）', () => {
  it('直线：全程就是长度除以速度（差不到一帧），剩余时间随走过的米数线性减少', () => {
    const path = new RoutePath([at(0, 0), at(40, 0)]);
    const timeline = new RouteTimeline(path, 4);
    expect(Math.abs(timeline.total - path.total / 4)).toBeLessThan(1 / 60);
    expect(timeline.remaining(0)).toBe(timeline.total);
    expect(timeline.remaining(path.total / 2)).toBeCloseTo(timeline.total / 2, 1);
    expect(timeline.remaining(path.total)).toBe(0);
    expect(timeline.remaining(path.total + 5)).toBe(0);
  });

  it('掉头：转身时放慢，比长度除以速度长；剩余时间一路减少', () => {
    const path = new RoutePath([at(0, 0), at(20, 0), at(0, 0.5)]);
    const timeline = new RouteTimeline(path, 4);
    expect(timeline.total).toBeGreaterThan(path.total / 4 + 1);
    const remaining = Array.from({ length: Math.floor(path.total) + 1 }, (_, meters) => timeline.remaining(meters));
    expect(remaining.every((value, index) => index === 0 || value < (remaining[index - 1] ?? Infinity))).toBe(true);
  });

  it('速度不是正数时报错', () => {
    expect(() => new RouteTimeline(new RoutePath([at(0, 0), at(1, 0)]), 0)).toThrow('不是正数');
  });
});
