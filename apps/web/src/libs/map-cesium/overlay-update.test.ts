// @vitest-environment node
import type { Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { LineShape, OverlayLayer, OverlayShape, PointShape, PolygonShape } from './overlay-plan';
import { LIVE_POINT_LIMIT, movableInPlace } from './overlay-update';

const BLUE = [0, 0, 1, 1] as const;
const RED = [1, 0, 0, 1] as const;

// 沿纬度的折线，count 个点
function path(latitude: number, count: number): Position[] {
  return Array.from({ length: count }, (_, index) => [118 + index / count, latitude + (index % 2) * 0.01]);
}

const line = (latitude: number, count = 3, width = 2): LineShape => ({
  kind: 'line',
  path: path(latitude, count),
  color: BLUE,
  width,
  dash: null
});

const polygon = (latitude: number, count: number): PolygonShape => ({
  kind: 'polygon',
  rings: [[...path(latitude, count - 1), [118, latitude]]],
  color: RED
});

const point = (latitude: number): PointShape => ({
  kind: 'point',
  position: [119, latitude],
  radius: 5,
  color: BLUE,
  strokeColor: RED,
  strokeWidth: 1
});

const layer = (...shapes: OverlayShape[]): OverlayLayer => ({ id: 'measure-line', order: 0, shapes });

describe('movableInPlace', () => {
  it('形状个数、样式都没变的小图层只换坐标：测量画线时不重建', () => {
    expect(movableInPlace(layer(line(32), point(32)), layer(line(31), point(31)))).toBe(true);
  });

  it('样式变了、形状个数变了都要重建', () => {
    expect(movableInPlace(layer(line(32)), layer(line(32, 3, 4)))).toBe(false);
    expect(movableInPlace(layer(line(32)), layer(line(32), line(31)))).toBe(false);
    expect(movableInPlace(layer(line(32)), layer(point(32)))).toBe(false);
  });

  it('线和面的点数合计超过上限时重建：每帧读取的贴地线、面每帧都在主线程上重建几何，边界一帧要几百毫秒', () => {
    const half = LIVE_POINT_LIMIT / 2;
    expect(movableInPlace(layer(line(32, LIVE_POINT_LIMIT)), layer(line(31, LIVE_POINT_LIMIT)))).toBe(true);
    expect(movableInPlace(layer(line(32, LIVE_POINT_LIMIT + 1)), layer(line(31, LIVE_POINT_LIMIT + 1)))).toBe(false);
    // 只看换之后的：每帧要重建的是换之后的几何
    expect(movableInPlace(layer(line(32)), layer(line(31, LIVE_POINT_LIMIT + 1)))).toBe(false);
    expect(movableInPlace(layer(line(32, LIVE_POINT_LIMIT + 1)), layer(line(31)))).toBe(true);
    expect(movableInPlace(layer(line(32, half), line(31, half + 1)), layer(line(30, half), line(29, half + 1)))).toBe(
      false
    );
    expect(movableInPlace(layer(polygon(32, LIVE_POINT_LIMIT + 1)), layer(polygon(31, LIVE_POINT_LIMIT + 1)))).toBe(
      false
    );
  });

  it('点不算：点的位置本来就每帧更新，换坐标不重建几何', () => {
    const points = Array.from({ length: LIVE_POINT_LIMIT + 1 }, (_, index) => point(30 + index / 1000));
    const moved = points.map(({ position: [lng = 0, lat = 0], ...rest }) => ({ ...rest, position: [lng, lat + 1] }));
    expect(movableInPlace(layer(...points), layer(...moved))).toBe(true);
  });
});
