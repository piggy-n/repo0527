// @vitest-environment node
import {
  Camera,
  Cartesian3,
  Ellipsoid,
  GeographicProjection,
  Matrix4,
  PerspectiveFrustum,
  SceneMode,
  type CesiumWidget,
  type Scene
} from 'cesium';
import type { CameraState } from '@yzt/map-core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createCesiumCameraPort, resizeCameraFrustum } from './camera-geometry';

const INITIAL: CameraState = { center: [118.8, 32.05], zoom: 8, bearing: 135, pitch: 45 };

// 真实 SDK Camera 的几何运算只需要这些场景信息，不创建 DOM 或 WebGL
function fixture(width = 1200, height = 800) {
  const canvas = { clientWidth: width, clientHeight: height };
  const scene = {
    canvas,
    drawingBufferWidth: width * 2,
    drawingBufferHeight: height * 2,
    mapProjection: new GeographicProjection(Ellipsoid.WGS84),
    ellipsoid: Ellipsoid.WGS84,
    mode: SceneMode.SCENE3D
  };
  // SDK 的构造参数要求完整 Scene，这里只代替几何运算实际读取的部分
  const camera = new Camera(scene as Scene);
  const host = { camera, canvas, scene };
  resizeCameraFrustum(host);
  return { ...host, port: createCesiumCameraPort(host) };
}

function expectCamera(actual: CameraState | null, expected: CameraState): void {
  expect(actual).not.toBeNull();
  expect(actual?.center[0]).toBeCloseTo(expected.center[0], 7);
  expect(actual?.center[1]).toBeCloseTo(expected.center[1], 7);
  expect(actual?.zoom).toBeCloseTo(expected.zoom, 7);
  expect(actual?.bearing).toBeCloseTo(expected.bearing, 6);
  expect(actual?.pitch).toBeCloseTo(expected.pitch, 6);
}

describe('Cesium 相机几何', () => {
  it('真实 Widget 满足窄接口', () => {
    expectTypeOf<CesiumWidget>().toExtend<Parameters<typeof createCesiumCameraPort>[0]>();
  });

  it.each([
    [1200, 800, 5, 0],
    [1200, 800, 8, 45],
    [600, 1000, 12, 60],
    [800, 800, 18, 20]
  ])('宽高 %i×%i、缩放 %i、俯角 %i 的往返不漂移', (width, height, zoom, pitch) => {
    const { port, camera } = fixture(width, height);
    const expected = { ...INITIAL, zoom, pitch };

    port.apply(expected);
    expectCamera(port.read(), expected);
    expect(Matrix4.equals(camera.transform, Matrix4.IDENTITY)).toBe(true);
    for (let count = 0; count < 5; count++) {
      const current = port.read();
      expect(current).not.toBeNull();
      if (current) {
        port.apply(current);
      }
    }
    expectCamera(port.read(), expected);
  });

  it('竖直视场角在横屏、竖屏及画布缩成零时保持有限', () => {
    const { camera, canvas, scene, port } = fixture();
    expect(camera.frustum).toBeInstanceOf(PerspectiveFrustum);
    const frustum = camera.frustum as PerspectiveFrustum;
    expect(frustum.fovy).toBeCloseTo(0.6435011087932844, 12);

    canvas.clientWidth = 600;
    canvas.clientHeight = 1000;
    resizeCameraFrustum({ camera, canvas, scene });
    expect(frustum.fovy).toBeCloseTo(0.6435011087932844, 12);

    canvas.clientWidth = 0;
    canvas.clientHeight = 0;
    resizeCameraFrustum({ camera, canvas, scene });
    port.apply(INITIAL);
    expect(Number.isFinite(camera.positionWC.x)).toBe(true);
    expect(Number.isFinite(frustum.fovy)).toBe(true);
    expect(port.read()).toBeNull();
  });

  it('高度按 CSS 像素计算，缩放一级让观察距离减半', () => {
    const { camera, port } = fixture();
    const target = Cartesian3.fromDegrees(...INITIAL.center);
    port.apply(INITIAL);
    const distance = Cartesian3.distance(camera.positionWC, target);
    // 独立核对当前 MapLibre 的平均地球半径、512 像素与竖直投影约定
    const expected = 2 * Math.PI * 6371008.8 * Math.cos(32.05 * Math.PI / 180) / 512 / 2 ** 8 * 800 * 1.5;
    expect(distance).toBeCloseTo(expected, 6);

    port.apply({ ...INITIAL, zoom: INITIAL.zoom + 1 });
    expect(Cartesian3.distance(camera.positionWC, target)).toBeCloseTo(distance / 2, 6);
  });

  it('相机对天空时不制造一个二维中心', () => {
    const { camera, port } = fixture();
    camera.setView({
      destination: Cartesian3.fromDegrees(118.8, 32.05, 1000),
      orientation: { heading: 0, pitch: Math.PI / 2, roll: 0 }
    });

    expect(port.read()).toBeNull();
  });

  it('共享纬度和俯角应用到当前三维允许的范围', () => {
    const { port } = fixture();
    port.apply({ ...INITIAL, center: [118.8, 90], pitch: 90 });

    expect(port.read()).not.toBeNull();
    expectCamera(port.read(), { ...INITIAL, center: [118.8, 85.05112878], pitch: 85 });
  });

  it('快照与原相机隔离，恢复精确位置和朝向', () => {
    const { port } = fixture();
    port.apply(INITIAL);
    const saved = port.capture();
    const originalPosition = Cartesian3.clone(saved.position);
    port.apply({ ...INITIAL, center: [120, 34], pitch: 0, bearing: 270 });
    expect(Cartesian3.equals(saved.position, originalPosition)).toBe(true);

    port.restore(saved);
    expect(port.equals(saved, port.capture())).toBe(true);
    expectCamera(port.read(), INITIAL);
    const shifted = {
      ...saved,
      position: Cartesian3.add(saved.position, new Cartesian3(0.001, 0, 0), new Cartesian3())
    };
    expect(port.equals(saved, shifted)).toBe(false);
  });
});
