// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchCamera } from './bench-api.ts';
import { sameCamera, syncStep } from './look-sync.ts';

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

  it('别的窗口动过以后才就绪的：跟到上一次的相机；已经就绪、没动的不跟', () => {
    const step = syncStep([at(120.41), at(120.4), at(120.4)], [at(120.41), null, at(120.4)], at(120.41));
    expect(step).toEqual({ leader: null, target: at(120.41), followers: [1] });
  });
});
