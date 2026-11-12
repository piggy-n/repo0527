// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchCamera } from './bench-api.ts';
import { ignoreBusy, interpolateCamera, sameCamera, segmentMs, syncStep } from './look-sync.ts';

const at = (lng: number, zoom = 17, bearing = 20): BenchCamera => ({ center: [lng, 31.5], zoom, pitch: 55, bearing });

describe('sameCamera', () => {
  it('读回来的舍入不算动过，方位按角度比', () => {
    expect(sameCamera(at(120.4), at(120.400000001))).toBe(true);
    expect(sameCamera(at(120.4, 17, 359.9999), at(120.4, 17, -0.0001))).toBe(true);
    expect(sameCamera(at(120.4), at(120.4001))).toBe(false);
    expect(sameCamera(at(120.4, 17), at(120.4, 17.01))).toBe(false);
    expect(sameCamera(at(120.4, 17, 20), at(120.4, 17, 21))).toBe(false);
  });
});

describe('interpolateCamera', () => {
  it('线性插值，两头就是 from 和 to', () => {
    const from = at(120.4, 17, 20);
    const to = { center: [120.5, 31.7] as const, zoom: 18, pitch: 65, bearing: 60 };
    expect(interpolateCamera(from, to, 0)).toEqual(from);
    const middle = interpolateCamera(from, to, 0.5);
    expect(middle.center[0]).toBeCloseTo(120.45);
    expect(middle.center[1]).toBeCloseTo(31.6);
    expect(middle.zoom).toBeCloseTo(17.5);
    expect(middle.pitch).toBeCloseTo(60);
    expect(middle.bearing).toBeCloseTo(40);
    expect(sameCamera(interpolateCamera(from, to, 1), to)).toBe(true);
  });

  it('方位走近的那一边：350° 到 10° 经过 0°，不倒转 340°', () => {
    expect(interpolateCamera(at(120.4, 17, 350), at(120.4, 17, 10), 0.5).bearing).toBeCloseTo(360);
    expect(interpolateCamera(at(120.4, 17, 10), at(120.4, 17, -170), 0.5).bearing).toBeCloseTo(-80);
  });
});

describe('segmentMs', () => {
  it('比同步间隔长一半，夹在 150～600 毫秒', () => {
    expect(segmentMs(200)).toBe(300);
    expect(segmentMs(10)).toBe(150);
    expect(segmentMs(2000)).toBe(600);
  });
});

describe('syncStep', () => {
  it('第一轮还没有记下的：谁也不跟', () => {
    expect(syncStep([at(120.4), at(120.5)], [null, null], null)).toEqual({ leader: null, target: null, followers: [] });
  });

  it('都没动：不设相机', () => {
    expect(syncStep([at(120.4), at(120.4)], [at(120.4), at(120.4)], at(120.4))).toEqual({ leader: null, target: null, followers: [] });
  });

  it('动了第二个窗口：其余的跟它，已经一样的不设', () => {
    const current = [at(120.4), at(120.41), at(120.41)];
    const known = [at(120.4), at(120.4), at(120.41)];
    expect(syncStep(current, known, null)).toEqual({ leader: 1, target: at(120.41), followers: [0] });
  });

  it('还没就绪的窗口不跟、也不当被跟的', () => {
    expect(syncStep([null, at(120.41), at(120.4)], [null, at(120.4), at(120.4)], null)).toEqual({ leader: 1, target: at(120.41), followers: [2] });
    expect(syncStep([at(120.41), null], [at(120.4), null], null)).toEqual({ leader: 0, target: at(120.41), followers: [] });
  });

  it('跟随中的窗口自己在走：不当成用户动了它，领头的照样领头', () => {
    // 窗口 0 被拖着走，窗口 1 正在往上一次的相机走（读到的是中途的位置）
    const current = [at(120.42), at(120.405)];
    const known = [at(120.41), at(120.4)];
    expect(syncStep(current, ignoreBusy(known, current, [false, true]), at(120.41))).toEqual({ leader: 0, target: at(120.42), followers: [1] });
    // 不忽略的话窗口 1 的变化也像用户动的；领头的是第一个被动的，这里还是 0，但只剩窗口 1 在走时就会反过来带着别人走
    expect(syncStep([at(120.42), at(120.405)], ignoreBusy([at(120.42), at(120.4)], [at(120.42), at(120.405)], [false, true]), at(120.42))).toEqual({
      leader: null,
      target: null,
      followers: []
    });
    expect(syncStep([at(120.42), at(120.405)], [at(120.42), at(120.4)], at(120.42)).leader).toBe(1);
  });

  it('别的窗口动过以后才就绪的：跟到上一次的相机；已经就绪、没动的不跟', () => {
    const step = syncStep([at(120.41), at(120.4), at(120.4)], [at(120.41), null, at(120.4)], at(120.41));
    expect(step).toEqual({ leader: null, target: at(120.41), followers: [1] });
  });
});
