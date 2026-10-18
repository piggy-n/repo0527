// @vitest-environment node
import {
  Camera,
  Cartesian3,
  Cartesian4,
  Ellipsoid,
  GeographicProjection,
  Matrix4,
  SceneMode,
  type Scene
} from 'cesium';
import type { CameraState, ViewBounds } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { createCesiumCameraPort, resizeCameraFrustum } from './camera-geometry';
import { planCesiumFitBounds, planCesiumFlyTo } from './camera-plan';

const INITIAL: CameraState = { center: [118.8, 32.05], zoom: 10, bearing: 70, pitch: 45 };

// 使用真实 SDK 相机和投影矩阵核对规划，测试只替代 WebGL 场景所需的尺寸信息
function fixture(width = 1200, height = 800) {
  const canvas = { clientWidth: width, clientHeight: height };
  const scene = {
    canvas, drawingBufferWidth: width * 2, drawingBufferHeight: height * 2,
    mapProjection: new GeographicProjection(Ellipsoid.WGS84), ellipsoid: Ellipsoid.WGS84, mode: SceneMode.SCENE3D
  };
  const camera = new Camera(scene as Scene);
  const host = { camera, canvas, scene };
  const port = createCesiumCameraPort(host);
  resizeCameraFrustum(host);
  port.apply(INITIAL);
  return { ...host, port };
}

function project(camera: Camera, width: number, height: number, longitude: number, latitude: number) {
  const world = Cartesian3.fromDegrees(longitude, latitude);
  const viewProjection = Matrix4.multiply(camera.frustum.projectionMatrix, camera.viewMatrix, new Matrix4());
  const clip = Matrix4.multiplyByVector(viewProjection, new Cartesian4(world.x, world.y, world.z, 1), new Cartesian4());
  expect(clip.w).toBeGreaterThan(0);
  return [(clip.x / clip.w + 1) * width / 2, (1 - clip.y / clip.w) * height / 2];
}

function expectOrientation(actual: CameraState | null, expected: Pick<CameraState, 'zoom' | 'bearing' | 'pitch'>): void {
  expect(actual).not.toBeNull();
  expect(actual?.zoom).toBeCloseTo(expected.zoom, 6);
  expect(actual?.bearing).toBeCloseTo(expected.bearing, 6);
  expect(actual?.pitch).toBeCloseTo(expected.pitch, 6);
}

describe('Cesium 定位规划', () => {
  it('规划不改变当前相机，应用后保持目标的共享相机状态', () => {
    const host = fixture();
    const before = host.port.capture();
    const target: CameraState = { center: [120, 34], zoom: 8, bearing: 235, pitch: 60 };
    const pose = planCesiumFlyTo(host, INITIAL, target);
    expect(host.port.equals(before, host.port.capture())).toBe(true);
    host.port.restore(pose);
    expectOrientation(host.port.read(), target);
    expect(host.port.read()?.center[0]).toBeCloseTo(120, 7);
    expect(host.port.read()?.center[1]).toBeCloseTo(34, 7);
  });

  it.each([
    [1200, 800, 45, { left: 20, right: 400, top: 100, bottom: 20 }],
    [600, 1000, 60, { left: 200, right: 10, top: 10, bottom: 300 }],
    [1200, 800, 0, { left: 100, right: 20, top: 50, bottom: 120 }]
  ])('在 %i×%i、俯角 %i 时按 CSS 留白居中且保留方向和缩放', (width, height, pitch, padding) => {
    const host = fixture(width, height);
    const target = { ...INITIAL, center: [120, 33] as const, pitch };
    host.port.restore(planCesiumFlyTo(host, INITIAL, target, { padding }));
    const point = project(host.camera, width, height, ...target.center);
    expect(point[0]).toBeCloseTo((padding.left + width - padding.right) / 2, 3);
    expect(point[1]).toBeCloseTo((padding.top + height - padding.bottom) / 2, 3);
    expectOrientation(host.port.read(), target);
  });

  it('没有目标中心时忽略留白，下一次定位也不会继承之前的留白', () => {
    const host = fixture();
    const target = { ...INITIAL, center: [120, 33] as const };
    host.port.restore(planCesiumFlyTo(host, INITIAL, target, { padding: { left: 20, right: 400, top: 20, bottom: 20 } }));
    host.port.restore(planCesiumFlyTo(host, target, { zoom: 11 }, { padding: -1 }));
    expect(project(host.camera, 1200, 800, ...target.center)).toEqual(expect.arrayContaining([
      expect.closeTo(600, 4), expect.closeTo(400, 4)
    ]));
    expectOrientation(host.port.read(), { ...target, zoom: 11 });
  });

  it.each([
    [[118, 30, 122, 35] as ViewBounds, 45],
    [[170, -10, -170, 10] as ViewBounds, 0],
    [[80, 65, 120, 80] as ViewBounds, 60]
  ])('球面范围 %j 的边缘和内部都落在非对称留白内，俯角 %i', (bounds, pitch) => {
    const host = fixture();
    const padding = { left: 120, right: 300, top: 80, bottom: 40 };
    const pose = planCesiumFitBounds(host, INITIAL, bounds, { padding, pitch });
    host.port.restore(pose);
    expect(((host.port.read()?.bearing ?? NaN) + 180) % 360 - 180).toBeCloseTo(0, 6);
    expect(host.port.read()?.pitch).toBeCloseTo(pitch, 6);
    const [west, south, east, north] = bounds;
    const span = east >= west ? east - west : east + 360 - west;
    for (let x = 0; x <= 10; x++) {
      for (let y = 0; y <= 10; y++) {
        const point = project(host.camera, 1200, 800, west + span * x / 10, south + (north - south) * y / 10);
        expect(point[0]).toBeGreaterThanOrEqual(padding.left - 0.001);
        expect(point[0]).toBeLessThanOrEqual(1200 - padding.right + 0.001);
        expect(point[1]).toBeGreaterThanOrEqual(padding.top - 0.001);
        expect(point[1]).toBeLessThanOrEqual(800 - padding.bottom + 0.001);
      }
    }
  });

  it('窄范围和单点遵守 maxZoom，并默认保留当前俯角', () => {
    const host = fixture();
    for (const bounds of [[119, 32, 119.0001, 32.0001], [119, 32, 119, 32]] as const) {
      host.port.restore(planCesiumFitBounds(host, INITIAL, bounds, { maxZoom: 8 }));
      expect(host.port.read()?.zoom).toBeCloseTo(8, 5);
      expect(host.port.read()?.pitch).toBeCloseTo(INITIAL.pitch, 6);
      expect(((host.port.read()?.bearing ?? NaN) + 180) % 360 - 180).toBeCloseTo(0, 6);
    }
  });

  it('非法范围、画布或留白立即失败，不改变原相机', () => {
    const host = fixture();
    const before = host.port.capture();
    expect(() => planCesiumFlyTo(host, INITIAL, { center: [119, NaN] })).toThrow(RangeError);
    expect(() => planCesiumFlyTo(host, INITIAL, { center: [119, 32] }, { padding: 600 })).toThrow(RangeError);
    expect(() => planCesiumFitBounds(host, INITIAL, [118, 35, 120, 30])).toThrow(RangeError);
    expect(() => planCesiumFitBounds(host, INITIAL, [118, 30, 120, 35], { maxZoom: Infinity })).toThrow(RangeError);
    host.canvas.clientHeight = 0;
    expect(() => planCesiumFlyTo(host, INITIAL, { zoom: 8 })).toThrow(RangeError);
    expect(host.port.equals(before, host.port.capture())).toBe(true);
  });
});
