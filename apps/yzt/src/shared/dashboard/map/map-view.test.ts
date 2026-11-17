// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { flatMapView, sceneMapView, type LngLat } from './map-view';

// 32°N 上经度相差 1° 约 94.5 千米，相差 0.5° 约 47.2 千米
const identity = (x: number, y: number): LngLat => [x, y];

describe('地图的朝向和比例', () => {
  it('三维取样两点换回经纬度后按椭球面距离算每像素米数，朝向原样传出', () => {
    const view = sceneMapView({ north: 4.2, sample: { a: [118, 32], b: [119, 32], pixels: 100 } }, identity);
    expect(view?.northDegrees).toBe(4.2);
    expect(view?.metersPerPixel).toBeCloseTo(945.0, 0);
  });

  it('打不到顶面、两点重合或距离不是有限值时为 null', () => {
    expect(sceneMapView({ north: 0, sample: null }, identity)).toBeNull();
    expect(sceneMapView({ north: 0, sample: { a: [118, 32], b: [118, 32], pixels: 100 } }, identity)).toBeNull();
    expect(sceneMapView({ north: Number.NaN, sample: { a: [118, 32], b: [119, 32], pixels: 100 } }, identity))
      .toBeNull();
  });

  it('二维降级正北朝上，比例按中心纬度上相距 0.5° 的两点在图上的距离', () => {
    // 每度经度 200 像素：0.5° 是 100 像素
    const view = flatMapView([119, 32], ([lng, lat]) => [lng * 200, -lat * 200]);
    expect(view?.northDegrees).toBe(0);
    expect(view?.metersPerPixel).toBeCloseTo(472.5, 0);
    expect(flatMapView([119, 32], () => null)).toBeNull();
    expect(flatMapView([119, 32], () => [10, 10])).toBeNull();
  });
});
