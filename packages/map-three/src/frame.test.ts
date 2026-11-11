// @vitest-environment node
import type { SceneFrame } from '@mx/map-core';
import { Matrix4, PerspectiveCamera, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { FrameMath, withDeeperFar } from './frame';

const NEAR = 10;
const FAR = 1000;
const IDENTITY = new Matrix4();

// 相机在原点上方 500、朝下看（墨卡托的投影矩阵是标准的 OpenGL 透视）
function frame(transition = 0): SceneFrame {
  const projection = new Matrix4().makePerspective(-5, 5, 5, -5, NEAR, FAR);
  const view = new Matrix4().makeTranslation(0, 0, -500);
  const main = projection.clone().multiply(view);
  return {
    mainMatrix: Float64Array.from(main.elements),
    fallbackMatrix: Float64Array.from(main.elements),
    projectionMatrix: Float64Array.from(projection.elements),
    transition,
    clippingPlane: [0, 0, 0, 0]
  };
}

// 世界坐标 z 处的点经 mainMatrix 投影
function clipOf({ mainMatrix }: SceneFrame, z: number): Vector4 {
  return new Vector4(0, 0, z, 1).applyMatrix4(new Matrix4().fromArray(mainMatrix));
}

describe('withDeeperFar', () => {
  it('moves the far plane away so points past it are no longer clipped', () => {
    const point = -600;
    const before = clipOf(frame(), point);
    const after = clipOf(withDeeperFar(frame()), point);

    expect(before.z / before.w).toBeGreaterThan(1);
    expect(after.z / after.w).toBeLessThan(1);
  });

  it('keeps the near plane and the screen position', () => {
    const near = clipOf(withDeeperFar(frame()), 500 - NEAR);
    const before = clipOf(frame(), -100);
    const after = clipOf(withDeeperFar(frame()), -100);

    expect(near.z / near.w).toBeCloseTo(-1, 6);
    expect([after.x, after.y, after.w]).toStrictEqual([before.x, before.y, before.w]);
  });

  it('leaves the camera taken from the clip matrix where it was', () => {
    const math = new FrameMath();
    const camera = (input: SceneFrame) => {
      const result = new PerspectiveCamera();
      math.syncCamera(result, new Matrix4().fromArray(input.mainMatrix).multiply(IDENTITY), input);
      return result.position.clone();
    };

    const moved = camera(withDeeperFar(frame()));

    expect(moved.distanceTo(camera(frame()))).toBeLessThan(1e-6);
    expect(moved.distanceTo(new Vector3(0, 0, 500))).toBeLessThan(1e-6);
  });

  it('leaves the globe projection alone: its far plane is already far enough', () => {
    const input = frame(0.5);

    expect(withDeeperFar(input)).toBe(input);
  });
});
