// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAPLIBRE_FOVY, zoomToDistance } from '../camera/camera-distance';
import { TILESET_PITCH, tilesetCamera } from './tileset-camera';

const VIEWPORT = 900;
const LNG = 117.06;
const LAT = 34.27;
const RADIUS = 120;
const FIT_DISTANCE = RADIUS / Math.sin(MAPLIBRE_FOVY / 2);
const PITCH = (TILESET_PITCH * Math.PI) / 180;

// 相机朝北：沿视线从地面的落点退到 height 高处，水平往南走 height·tan(俯角)，走过的长度是 height / cos(俯角)
function viewOf(height: number) {
  const camera = tilesetCamera({ center: [LNG, LAT], height, radius: RADIUS }, VIEWPORT);
  const toAim = zoomToDistance(camera.zoom, camera.center[1], VIEWPORT, MAPLIBRE_FOVY);
  const northOfCenter = (camera.center[1] - LAT) * 111320;
  return { camera, northOfCenter, toAim };
}

describe('tilesetCamera', () => {
  it('球心在地面上：对准球心，距离刚好放下球的直径', () => {
    const { camera, toAim } = viewOf(0);
    expect(camera.center).toEqual([LNG, LAT]);
    expect(toAim).toBeCloseTo(FIT_DISTANCE, 6);
    expect(camera.bearing).toBe(0);
    expect(camera.pitch).toBe(TILESET_PITCH);
  });

  it.each([
    ['离地 84 米（楚王山1号）', 84],
    ['离地 300 米', 300],
    ['地下 25 米', -25]
  ])('%s：视线穿过球心，相机到球心的距离不变', (_name, height) => {
    const { camera, northOfCenter, toAim } = viewOf(height);
    expect(camera.center[0]).toBe(LNG);
    // 从相机状态还原眼睛的位置（北、上），再量眼睛到球心的向量
    const eyeNorth = northOfCenter - toAim * Math.sin(PITCH);
    const eyeUp = toAim * Math.cos(PITCH);
    const toCenterNorth = -eyeNorth;
    const toCenterUp = height - eyeUp;
    expect(Math.hypot(toCenterNorth, toCenterUp)).toBeCloseTo(FIT_DISTANCE, 1);
    expect(Math.atan2(toCenterNorth, -toCenterUp)).toBeCloseTo(PITCH, 3);
  });

  it('球心在空中时落点在球心以北、拉远；在地下时相反', () => {
    const above = viewOf(84);
    const below = viewOf(-25);
    expect(above.northOfCenter).toBeGreaterThan(100);
    expect(above.toAim).toBeGreaterThan(FIT_DISTANCE);
    expect(below.northOfCenter).toBeLessThan(0);
    expect(below.toAim).toBeLessThan(FIT_DISTANCE);
  });

  it('埋得比半径深很多时相机到不了地下：距离停在 1 米', () => {
    const { camera, toAim } = viewOf(-5000);
    expect(Number.isFinite(camera.zoom)).toBe(true);
    expect(toAim).toBeCloseTo(1, 6);
  });
});
