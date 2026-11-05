// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  fitCamera,
  keepCamera,
  MAX_SCALE,
  panCamera,
  planeToScreen,
  scaleBar,
  screenToPlane,
  zoomCamera
} from './map-camera';

const VIEW = { width: 800, height: 600 };

describe('完整地图的取景', () => {
  it('整层放得进 150 米宽以内就整层显示、居中；更大的楼层以人为中心显示 150 米宽', () => {
    const small = fitCamera({ left: 0, top: 50, width: 100, height: 50 }, VIEW, [10, 10]);
    expect(small.camera).toStrictEqual({ east: 50, north: 25, scale: 8 });
    expect(small.minScale).toBeCloseTo(6.4, 9);

    const big = fitCamera({ left: 0, top: 200, width: 600, height: 200 }, VIEW, [120, 80]);
    expect(big.camera.east).toBe(120);
    expect(big.camera.north).toBe(80);
    expect(big.camera.scale).toBeCloseTo(800 / 150, 9);
    expect(big.minScale).toBeCloseTo((800 / 600) * 0.8, 9);
  });

  it('很小的楼层也不超过最大放大', () => {
    const tiny = fitCamera({ left: 0, top: 5, width: 10, height: 5 }, VIEW, [0, 0]);
    expect(tiny.camera.scale).toBe(MAX_SCALE);
  });

  it('换一层看：位置和比例不变，比例小于新楼层的下限时抬到下限', () => {
    const camera = { east: 10, north: 20, scale: 1 };
    expect(keepCamera(camera, { left: 0, top: 50, width: 100, height: 50 }, VIEW).camera).toStrictEqual({
      east: 10,
      north: 20,
      scale: 6.4
    });
    const box = { left: 0, top: 50, width: 100, height: 50 };
    expect(keepCamera({ ...camera, scale: 9 }, box, VIEW).camera.scale).toBe(9);
  });
});

describe('换算、缩放和拖动', () => {
  const camera = { east: 100, north: 50, scale: 4 };

  it('画布上的点和平面坐标互逆，中心就是相机的中心，往下是往南', () => {
    expect(screenToPlane(camera, VIEW, 400, 300)).toStrictEqual([100, 50]);
    expect(screenToPlane(camera, VIEW, 440, 340)).toStrictEqual([110, 40]);
    expect(planeToScreen(camera, VIEW, 110, 40)).toStrictEqual([440, 340]);
  });

  it('以鼠标处为不动点缩放，比例限制在下限和最大放大之间', () => {
    const zoomed = zoomCamera(camera, VIEW, 2, 1, 600, 100);
    expect(zoomed.scale).toBe(8);
    expect(screenToPlane(zoomed, VIEW, 600, 100)).toStrictEqual(screenToPlane(camera, VIEW, 600, 100));
    expect(zoomCamera(camera, VIEW, 100, 1).scale).toBe(MAX_SCALE);
    expect(zoomCamera(camera, VIEW, 0.01, 1).scale).toBe(1);
  });

  it('拖动时画面跟着鼠标走：往右下拖，看到的是西北边', () => {
    expect(panCamera(camera, 40, 20)).toStrictEqual({ east: 90, north: 55, scale: 4 });
  });

  it('比例尺取不超过最大长度的 1、2、5 × 10ⁿ 米', () => {
    expect(scaleBar(4, 120)).toStrictEqual({ meters: 20, pixels: 80 });
    expect(scaleBar(0.5, 120)).toStrictEqual({ meters: 200, pixels: 100 });
    expect(scaleBar(10, 100)).toStrictEqual({ meters: 10, pixels: 100 });
  });
});
