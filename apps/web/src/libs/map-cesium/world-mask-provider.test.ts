// @vitest-environment node
import { Cartesian3, Cartographic, GeographicTilingScheme, Rectangle, WebMercatorProjection } from 'cesium';
import type { GeoJSON, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import { hasWorldMask, maskTilePath } from './world-mask-provider';

const WORLD: Position[] = [
  [-180, -85.051129], [180, -85.051129], [180, 85.051129], [-180, 85.051129], [-180, -85.051129]
];

const geometry = (ring: Position[]): GeoJSON => ({ type: 'Polygon', coordinates: [ring] });

describe('全球遮罩的几何识别与投影', () => {
  it('只识别闭合的四角世界外环，允许方向、起点和既有小数精度差异', () => {
    expect(hasWorldMask(geometry(WORLD))).toBe(true);
    expect(hasWorldMask(geometry(WORLD.toReversed()))).toBe(true);
    expect(hasWorldMask(geometry([...WORLD.slice(2, 4), ...WORLD.slice(0, 3)]))).toBe(true);
    expect(hasWorldMask(geometry(WORLD.map(([x, y]) => [x, Math.sign(y) * 85.0511287798066])))).toBe(true);
    expect(hasWorldMask(geometry(WORLD.map(([x, y]) => [x, Math.sign(y) * 85])))).toBe(false);
    expect(hasWorldMask(geometry(WORLD.map(([x, y]) => [x * 0.99, y])))).toBe(false);
    expect(hasWorldMask(geometry([WORLD[0], WORLD[2], WORLD[1], WORLD[3], WORLD[0]]))).toBe(false);
    expect(hasWorldMask(geometry(WORLD.slice(0, 4)))).toBe(false);
  });

  it('FeatureCollection 与 GeometryCollection 保留世界外环，普通洞不能触发全球补集', () => {
    expect(hasWorldMask({ type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [
        { type: 'MultiPolygon', coordinates: [[WORLD]] }
      ] }
    }] })).toBe(true);
    expect(hasWorldMask({ type: 'Polygon', coordinates: [
      [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]], WORLD
    ] })).toBe(false);
  });

  it.each([
    [10, -75, 170, 75],
    [138.12850610422822, -54.5047570056692, 167.02540414143084, 64.41433146135404]
  ])('地理瓦片里的斜边保持墨卡托直线，采样误差不超过四分之一像素（%s,%s→%s,%s）', (west, south, east, north) => {
    const projection = new WebMercatorProjection();
    const bounds = Rectangle.fromDegrees(0, -90, 180, 90);
    const first = projection.project(Cartographic.fromDegrees(west, south));
    const last = projection.project(Cartographic.fromDegrees(east, north));
    const path = maskTilePath([[first.x, first.y], [last.x, last.y]], bounds, projection);
    expect(path.length).toBeGreaterThan(10);
    let maximum = 0;
    for (let index = 1; index < 1000; index++) {
      const point = projection.unproject(new Cartesian3(
        first.x + (last.x - first.x) * index / 1000,
        first.y + (last.y - first.y) * index / 1000
      ));
      const x = point.longitude / Math.PI * 512;
      const y = (Math.PI / 2 - point.latitude) / Math.PI * 512;
      const segment = path.findIndex((end, at) => at > 0 && end[0] >= x);
      const a = path[segment - 1];
      const b = path[segment];
      const error = Math.abs((b[0] - a[0]) * (a[1] - y) - (a[0] - x) * (b[1] - a[1])) /
        Math.hypot(b[0] - a[0], b[1] - a[1]);
      maximum = Math.max(maximum, error);
    }
    expect(maximum).toBeLessThanOrEqual(0.25);
  });

  it('远离高层级瓦片的边不细分，垂直边不会因参数速度不同产生无用细分', () => {
    const projection = new WebMercatorProjection();
    const first = projection.project(Cartographic.fromDegrees(10, -75));
    const last = projection.project(Cartographic.fromDegrees(170, 75));
    const bounds = new GeographicTilingScheme().tileXYToRectangle(0, 0, 22);
    expect(maskTilePath([[first.x, first.y], [last.x, last.y]], bounds, projection)).toHaveLength(2);
    expect(maskTilePath([[first.x, first.y], [first.x, last.y]],
      Rectangle.fromDegrees(0, -90, 180, 90), projection)).toHaveLength(2);
  });

  it('赤道附近弦斜率舍入到1或边线反向时仍保持有限坐标', () => {
    const projection = new WebMercatorProjection();
    const bounds = Rectangle.fromDegrees(0, -90, 180, 90);
    const first = projection.project(Cartographic.fromDegrees(10, -0.00000001));
    const last = projection.project(Cartographic.fromDegrees(20, 0.00000001));
    const forward = maskTilePath([[first.x, first.y], [last.x, last.y]], bounds, projection);
    const reverse = maskTilePath([[last.x, last.y], [first.x, first.y]], bounds, projection);
    expect(forward).toHaveLength(2);
    expect(forward.flat().every(Number.isFinite)).toBe(true);
    expect(reverse).toEqual(forward.toReversed());
  });

  it('不同墨卡托 y 舍入为相同纬度时，微小边保持直线且不会让整层失败', () => {
    const projection = new WebMercatorProjection();
    const bounds = Rectangle.fromDegrees(0, -90, 180, 90);
    const first = projection.project(Cartographic.fromDegrees(10, 70));
    const last = new Cartesian3(first.x + 1, first.y + Number.EPSILON * first.y);
    expect(last.y).not.toBe(first.y);
    expect(projection.unproject(last).latitude).toBe(projection.unproject(first).latitude);
    const path = maskTilePath([[first.x, first.y], [last.x, last.y]], bounds, projection);
    expect(path).toHaveLength(2);
    expect(path.flat().every(Number.isFinite)).toBe(true);
  });
});
