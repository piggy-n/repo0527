// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fitBoundsCamera, paddedCenter, paddingBox } from './camera-fit';

const TILE_SIZE = 512;
const mercatorX = (lng: number) => (lng + 180) / 360;
const mercatorY = (lat: number) => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
};
// 经纬度在画布上相对中心的像素位置（方位为 0）
const screenOffset = (point: readonly [number, number], center: readonly [number, number], zoom: number) => {
  const scale = TILE_SIZE * 2 ** zoom;
  return {
    x: (mercatorX(point[0]) - mercatorX(center[0])) * scale,
    y: (mercatorY(point[1]) - mercatorY(center[1])) * scale
  };
};

const JIANGSU = [116.35, 30.75, 121.95, 35.15] as const;

describe('fitBoundsCamera', () => {
  it('范围正好放进画布：一边贴满、另一边放得下，方位归零、俯角照给定的', () => {
    const camera = fitBoundsCamera(JIANGSU, { width: 1000, height: 800 }, { pitch: 30 });
    const topLeft = screenOffset([JIANGSU[0], JIANGSU[3]], camera.center, camera.zoom);
    const bottomRight = screenOffset([JIANGSU[2], JIANGSU[1]], camera.center, camera.zoom);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    expect(Math.max(width / 1000, height / 800)).toBeCloseTo(1, 9);
    expect(topLeft.x).toBeCloseTo(-width / 2, 9);
    expect(topLeft.y).toBeCloseTo(-height / 2, 9);
    expect(camera.bearing).toBe(0);
    expect(camera.pitch).toBe(30);
  });

  it('有留白时放进剩下的区域，并在这块区域里居中', () => {
    const padding = { top: 20, right: 40, bottom: 60, left: 360 };
    const camera = fitBoundsCamera(JIANGSU, { width: 1000, height: 800 }, { padding, pitch: 0 });
    const topLeft = screenOffset([JIANGSU[0], JIANGSU[3]], camera.center, camera.zoom);
    const bottomRight = screenOffset([JIANGSU[2], JIANGSU[1]], camera.center, camera.zoom);

    expect(Math.max((bottomRight.x - topLeft.x) / 600, (bottomRight.y - topLeft.y) / 720)).toBeCloseTo(1, 9);
    // 区域中央在画布中心右边 (360 - 40) / 2、上边 (60 - 20) / 2 的位置
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(160, 6);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(-20, 6);
  });

  it('不超过 maxZoom；范围是一个点时用 maxZoom，没有时 20 级', () => {
    const point = [119, 32, 119, 32] as const;

    expect(fitBoundsCamera(JIANGSU, { width: 1000, height: 800 }, { maxZoom: 5, pitch: 0 }).zoom).toBe(5);
    const atPoint = fitBoundsCamera(point, { width: 1000, height: 800 }, { maxZoom: 16, pitch: 0 });
    expect(atPoint.zoom).toBe(16);
    expect(atPoint.center[0]).toBeCloseTo(119, 9);
    expect(atPoint.center[1]).toBeCloseTo(32, 9);
    expect(fitBoundsCamera(point, { width: 1000, height: 800 }, { pitch: 0 }).zoom).toBe(20);
  });
});

describe('paddedCenter', () => {
  it('没有留白或四边相同时中心不变', () => {
    expect(paddedCenter([119, 32], 10, 0, undefined)).toStrictEqual([119, 32]);
    expect(paddedCenter([119, 32], 10, 30, 50)).toStrictEqual([119, 32]);
  });

  it('左边留得多，目标显示在中心右边：画布中心移到目标左边', () => {
    const center = paddedCenter([119, 32], 10, 0, { top: 0, right: 0, bottom: 0, left: 200 });
    const offset = screenOffset([119, 32], center, 10);

    expect(offset.x).toBeCloseTo(100, 6);
    expect(offset.y).toBeCloseTo(0, 6);
  });

  it('地图转过 90° 时屏幕上的左右对应地图上的南北', () => {
    // 方位 90°：屏幕上方是东。目标要显示在屏幕右边（南），画布中心就在目标北边
    const center = paddedCenter([119, 32], 10, 90, { top: 0, right: 0, bottom: 0, left: 200 });

    expect(center[0]).toBeCloseTo(119, 9);
    expect(center[1]).toBeGreaterThan(32);
  });

  it('数字的留白四边相同', () => {
    expect(paddingBox(12)).toStrictEqual({ top: 12, right: 12, bottom: 12, left: 12 });
    expect(paddingBox(undefined)).toStrictEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
