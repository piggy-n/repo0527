import { describe, expect, it } from 'vitest';
import { RoutePath } from '../../scene/route-path';
import { RouteTimeline } from '../../scene/route-play';
import type { RoamHost } from './roam-host';
import { RouteRoamer } from './route-roamer';

// 局部的米（东、北）换成 [经度, 纬度, 地板]
const at = (east: number, north: number): [number, number, number] => [
  120 + east / (111320 * Math.cos((31 * Math.PI) / 180)),
  31 + north / 110900,
  0
];

// 只记进度的宿主：tick 由用例按 60 帧/秒调
function play(path: RoutePath, speed: number) {
  const host: RoamHost = {
    container: document.createElement('div'),
    canvas: document.createElement('div'),
    setEye: () => undefined,
    pick: () => null,
    project: () => null,
    requestFrame: () => undefined,
    setMarker: () => undefined
  };
  const frames: { readonly time: number; readonly distance: number }[] = [];
  let end: number | null = null;
  let now = 0;
  const roamer = new RouteRoamer(host, {
    progress: distance => frames.push({ time: now / 1000, distance }),
    end: () => (end = now / 1000)
  });
  roamer.start(path);
  roamer.place();
  roamer.setPlayback({ playing: true, speed });
  // 结束事件在 tick 里改 end
  for (; now < 600_000; now += 1000 / 60) {
    roamer.tick(now);
    if (end !== null) {
      break;
    }
  }
  roamer[Symbol.dispose]();
  return { frames, end };
}

describe('RouteRoamer（ADR 0156 R.5）', () => {
  it('播放和估算按同一个规则：60 帧/秒走完的时间就是估算的全程，途中每帧的剩余时间对得上', () => {
    // 往东 20 米、往北拐 10 米，再折回来：直角弯和掉头都有
    const path = new RoutePath([at(0, 0), at(20, 0), at(20, 10), at(20, 0.5)]);
    const timeline = new RouteTimeline(path, 4);
    const { frames, end } = play(path, 4);

    expect(end).not.toBeNull();
    expect(end ?? 0).toBeCloseTo(timeline.total, 6);
    const off = frames.map(({ time, distance }) => Math.abs(timeline.remaining(distance) - (timeline.total - time)));
    expect(Math.max(...off)).toBeLessThan(0.02);
  });
});
