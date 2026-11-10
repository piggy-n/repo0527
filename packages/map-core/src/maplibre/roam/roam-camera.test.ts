// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { zoomToDistance, MAPLIBRE_FOVY } from '../../camera/camera-distance';
import {
  anglesOf,
  EXIT_HEIGHT,
  exitCamera,
  eyeOf,
  firstPersonCamera,
  groundCamera,
  liftFor,
  ROAM_MAX_ZOOM
} from './roam-camera';

// 苏州站附近
const AT = { lng: 120.6661, lat: 31.3176 };
const HEIGHT = 900;
const FOVY = (60 * Math.PI) / 180;
const EARTH = 6371008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function mercator(lng: number, lat: number, height: number): [number, number, number] {
  const x = (180 + lng) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + toRadians(lat) / 2))) / 360;
  return [x, y, height / (2 * Math.PI * EARTH * Math.cos(toRadians(lat)))];
}

// 像 MapLibre 一样由中心、高度、缩放、方位、俯仰放回相机（墨卡托），换成米
function cameraOf(
  camera: ReturnType<typeof firstPersonCamera>,
  viewportHeight: number,
  fovy: number
): [number, number, number] {
  const [x, y, z] = mercator(camera.center[0], camera.center[1], camera.elevation);
  const distance = (0.5 / Math.tan(fovy / 2)) * viewportHeight / (512 * 2 ** camera.zoom);
  const p = toRadians(camera.pitch);
  const b = toRadians(camera.bearing);
  return [x - Math.sin(p) * Math.sin(b) * distance, y + Math.sin(p) * Math.cos(b) * distance, z + Math.cos(p) * distance];
}

function metersBetween(a: readonly number[], b: readonly number[], lat: number): number {
  const scale = 2 * Math.PI * EARTH * Math.cos(toRadians(lat));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * scale;
}

describe('roam camera (ADR 0147 §4)', () => {
  it('converts angles to an eye and back', () => {
    const angles = { ...AT, height: -8.4, heading: 76, pitch: -12 };
    const back = anglesOf(eyeOf(angles));

    expect(back.lng).toBeCloseTo(AT.lng, 9);
    expect(back.lat).toBeCloseTo(AT.lat, 9);
    expect(back.height).toBeCloseTo(-8.4, 6);
    expect(back.heading).toBeCloseTo(76, 9);
    expect(back.pitch).toBeCloseTo(-12, 9);
  });

  it.each([
    ['looking level', 0, 0],
    ['looking down', 120, -40],
    ['looking up', 300, 35]
  ])('places the MapLibre camera at the lifted eye, %s', (_name, heading, pitch) => {
    const eye = eyeOf({ ...AT, height: -8.4, heading, pitch });
    const camera = firstPersonCamera(eye, { lift: 16, viewportHeight: HEIGHT, fovy: FOVY });

    const placed = cameraOf(camera, HEIGHT, FOVY);
    expect(metersBetween(placed, mercator(AT.lng, AT.lat, -8.4 + 16), AT.lat)).toBeLessThan(0.002);
    // 东、北按椭球、高度按 MapLibre 的球换成墨卡托（和模型的锚点矩阵一致），角度和椭球上的差零点几度
    expect(Math.abs(camera.bearing - (heading > 180 ? heading - 360 : heading))).toBeLessThan(0.5);
    expect(Math.abs(camera.pitch - (90 + pitch))).toBeLessThan(0.5);
    expect(camera.zoom).toBeLessThanOrEqual(ROAM_MAX_ZOOM);
  });

  it('moves the target farther away when the field of view is narrow, keeping the zoom under the limit', () => {
    const eye = eyeOf({ ...AT, height: 3, heading: 0, pitch: 0 });
    const wide = firstPersonCamera(eye, { lift: 0, viewportHeight: 2160, fovy: FOVY });
    const narrow = firstPersonCamera(eye, { lift: 0, viewportHeight: 2160, fovy: toRadians(20) });

    expect(wide.zoom).toBeLessThanOrEqual(23.5 + 1e-9);
    expect(narrow.zoom).toBeCloseTo(23.5, 1);
    expect(narrow.zoom).toBeLessThanOrEqual(23.5);
    expect(metersBetween(cameraOf(narrow, 2160, toRadians(20)), mercator(AT.lng, AT.lat, 3), AT.lat)).toBeLessThan(0.002);
  });

  it('gives the session the ground point the eye looks at, in real heights', () => {
    const eye = eyeOf({ ...AT, height: 100, heading: 90, pitch: -45 });
    const camera = groundCamera(eye, HEIGHT);

    // 往东看、俯角 45°：中心在东边 100 米的地面上，离视点 100√2 米
    expect(camera.center[1]).toBeCloseTo(AT.lat, 5);
    expect((camera.center[0] - AT.lng) * 111320 * Math.cos(toRadians(AT.lat))).toBeCloseTo(100, 0);
    expect(camera.pitch).toBeCloseTo(45, 6);
    expect(camera.bearing).toBeCloseTo(90, 6);
    expect(zoomToDistance(camera.zoom, AT.lat, HEIGHT, MAPLIBRE_FOVY)).toBeCloseTo(100 * Math.SQRT2, 3);
  });

  it('falls back to the point under the eye when the eye is underground or looks level', () => {
    for (const eye of [
      eyeOf({ ...AT, height: -8.4, heading: 30, pitch: -20 }),
      eyeOf({ ...AT, height: 1.6, heading: 30, pitch: 0 })
    ]) {
      const camera = groundCamera(eye, HEIGHT);
      expect(camera.center[0]).toBeCloseTo(AT.lng, 9);
      expect(camera.center[1]).toBeCloseTo(AT.lat, 9);
      expect(camera.pitch).toBe(0);
      expect(camera.bearing).toBeCloseTo(30, 6);
      expect(Number.isFinite(camera.zoom)).toBe(true);
    }
  });

  it('leaves the model to a point above the eye, with the pitch and zoom inside the limits', () => {
    const camera = exitCamera(eyeOf({ ...AT, height: -8.4, heading: 200, pitch: 10 }), HEIGHT, 18);

    expect(camera.pitch).toBeCloseTo(60, 9);
    expect(camera.bearing).toBeCloseTo(200, 6);
    expect(camera.zoom).toBeLessThanOrEqual(18);
    const level = exitCamera(eyeOf({ ...AT, height: -8.4, heading: 200, pitch: -90 }), HEIGHT, 24);
    expect(level.pitch).toBeCloseTo(0, 4);
    expect(zoomToDistance(level.zoom, AT.lat, HEIGHT, MAPLIBRE_FOVY)).toBeCloseTo(EXIT_HEIGHT, 3);
  });

  it('lifts a model whose lowest point plus the eye height is not 2 m above sea level, rounded up to a meter', () => {
    expect(liftFor(-15)).toBe(16);
    expect(liftFor(-15.7)).toBe(17);
    expect(liftFor(0.4)).toBe(0);
    expect(liftFor(40)).toBe(0);
  });
});
