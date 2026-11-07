// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { probePoses } from './probe-sequence';

describe('probePoses', () => {
  it('级别 15～18 各俯视、倾斜一次，共 8 个姿态，都对着同一个中心、正北朝上', () => {
    const poses = probePoses([120.3, 31.5]);

    expect(poses.map(({ label }) => label)).toEqual([
      'z15 俯视',
      'z15 倾斜',
      'z16 俯视',
      'z16 倾斜',
      'z17 俯视',
      'z17 倾斜',
      'z18 俯视',
      'z18 倾斜'
    ]);
    expect(poses.map(({ camera }) => [camera.zoom, camera.pitch])).toEqual([
      [15, 0],
      [15, 55],
      [16, 0],
      [16, 55],
      [17, 0],
      [17, 55],
      [18, 0],
      [18, 55]
    ]);
    expect(poses.every(({ camera }) => camera.center[0] === 120.3 && camera.center[1] === 31.5)).toBe(true);
    expect(poses.every(({ camera }) => camera.bearing === 0)).toBe(true);
  });
});
