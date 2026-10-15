// @vitest-environment node
import { simplify } from '@turf/simplify';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import cityFile from '@/shared/map/boundary/data/jiangsu-city.json?raw';
import { clipToScope } from '@/shared/map/region/region-scope';
import {
  isValidPolygonal,
  QUERY_VERTEX_LIMIT,
  queryGeometry,
  roundPolygonal,
  SIMPLIFY_PIXELS,
  vertexCount
} from './query-geometry';

function square(x: number, y: number, size: number): Position[] {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y]
  ];
}

const polygon = (...rings: Position[][]): Polygon => ({ type: 'Polygon', coordinates: rings });
const multi = (...polygons: Position[][][]): MultiPolygon => ({ type: 'MultiPolygon', coordinates: polygons });
const box = (west: number, south: number, east: number, north: number) =>
  polygon([
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ]);

// 圆心 (120, 32)、半径 radius 度、count 个顶点的多边形
function circle(count: number, radius: number): Polygon {
  const ring = Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    return [120 + radius * Math.cos(angle), 32 + radius * Math.sin(angle)];
  });
  return polygon([...ring, ring[0] ?? [120, 32]]);
}

// 点到线段的距离（经纬度当平面坐标）
function segmentDistance([px = 0, py = 0]: Position, [ax = 0, ay = 0]: Position, [bx = 0, by = 0]: Position): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length = dx * dx + dy * dy;
  const ratio = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - ax - ratio * dx, py - ay - ratio * dy);
}

// 原来的每个顶点到简化后的环的最短距离中最大的
function maxDeviation(original: Position[], simplified: Position[]): number {
  return Math.max(
    ...original.map(point =>
      Math.min(...simplified.slice(1).map((end, index) => segmentDistance(point, simplified[index] ?? end, end)))
    )
  );
}

function nantong(): Polygon | MultiPolygon {
  const { features } = JSON.parse(cityFile) as {
    features: { properties: { code: string }; geometry: Polygon | MultiPolygon }[];
  };
  const feature = features.find(({ properties }) => properties.code.startsWith('320600'));
  if (!feature) {
    throw new Error('市界里没有南通');
  }
  return feature.geometry;
}

describe('发给后端的几何：舍入', () => {
  it('坐标保留 6 位小数，舍入后相邻的重复坐标去掉；Polygon 仍是 Polygon', () => {
    const rounded = roundPolygonal(
      polygon([
        [120.1234564, 32.1],
        [120.1234561, 32.1],
        [120.2, 32.1],
        [120.2, 32.2],
        [120.1234564, 32.1]
      ])
    );

    expect(rounded).toStrictEqual(
      polygon([
        [120.123456, 32.1],
        [120.2, 32.1],
        [120.2, 32.2],
        [120.123456, 32.1]
      ])
    );
  });

  it('退化的洞去掉；外环退化时去掉这个部分；全部退化时为 null', () => {
    const tinyHole = [
      [120.5, 32.5],
      [120.5000001, 32.5],
      [120.5, 32.5000001],
      [120.5, 32.5]
    ];
    const tinyPart = tinyHole.map(([lng = 0, lat = 0]) => [lng + 1, lat]);
    // 舍入后只剩两个不同的点（一条线）
    const flatHole = [
      [120.5, 32.5],
      [120.6, 32.5],
      [120.6000001, 32.5],
      [120.5, 32.5]
    ];

    expect(roundPolygonal(polygon(square(120, 32, 1), square(120.2, 32.2, 0.5)))).toStrictEqual(
      polygon(square(120, 32, 1), square(120.2, 32.2, 0.5))
    );
    expect(roundPolygonal(polygon(square(120, 32, 1), tinyHole))).toStrictEqual(polygon(square(120, 32, 1)));
    expect(roundPolygonal(polygon(square(120, 32, 1), flatHole))).toStrictEqual(polygon(square(120, 32, 1)));
    expect(roundPolygonal(multi([square(120, 32, 0.1)], [tinyPart]))).toStrictEqual(multi([square(120, 32, 0.1)]));
    expect(roundPolygonal(polygon(tinyPart))).toBeNull();
  });

  it('坐标的个数含每个环的终点', () => {
    expect(vertexCount(polygon(square(0, 0, 4), square(1, 1, 1)))).toBe(10);
    expect(vertexCount(multi([square(0, 0, 1)], [square(3, 0, 1)]))).toBe(10);
  });
});

describe('发给后端的几何：有效性', () => {
  it('合法的多边形、带洞的、多个部分的、在别的部分洞里的小岛都有效', () => {
    expect(isValidPolygonal(polygon(square(0, 0, 4)))).toBe(true);
    expect(isValidPolygonal(polygon(square(0, 0, 4), square(1, 1, 2)))).toBe(true);
    expect(isValidPolygonal(multi([square(0, 0, 1)], [square(3, 0, 1)]))).toBe(true);
    expect(isValidPolygonal(multi([square(0, 0, 10), square(2, 2, 6)], [square(4, 4, 2)]))).toBe(true);
  });

  it('外环自相交、自己在一个顶点相接都无效', () => {
    const bowTie = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
      [0, 0]
    ];
    const figureEight = [
      [0, 0],
      [2, 0],
      [1, 1],
      [2, 2],
      [0, 2],
      [1, 1],
      [0, 0]
    ];

    expect(isValidPolygonal(polygon(bowTie))).toBe(false);
    expect(isValidPolygonal(polygon(figureEight))).toBe(false);
  });

  it('共线重叠无效：两个部分共用一段边；首尾相连的两段折回（三个点共线、面积为零的环）', () => {
    const sharingEdge = multi([square(0, 0, 2)], [square(2, 1, 2)]);
    // 三条边两两首尾相连，只有"折回"这一条规则能拦下
    const flat = [
      [0, 0],
      [4, 0],
      [2, 0],
      [0, 0]
    ];

    expect(isValidPolygonal(sharingEdge)).toBe(false);
    expect(isValidPolygonal(polygon(flat))).toBe(false);
  });

  it('洞在外环外、洞在别的洞里、部分套在部分里（不在洞里）、洞和外环相接都无效', () => {
    const touchingHole = [
      [0, 0],
      [2, 1],
      [1, 2],
      [0, 0]
    ];

    expect(isValidPolygonal(polygon(square(0, 0, 2), square(5, 5, 1)))).toBe(false);
    expect(isValidPolygonal(polygon(square(0, 0, 10), square(1, 1, 6), square(2, 2, 2)))).toBe(false);
    expect(isValidPolygonal(multi([square(0, 0, 10)], [square(2, 2, 2)]))).toBe(false);
    expect(isValidPolygonal(polygon(square(0, 0, 4), touchingHole))).toBe(false);
  });

  it('环不闭合或不足 4 个坐标时无效', () => {
    expect(isValidPolygonal(polygon(square(0, 0, 1).slice(0, 4)))).toBe(false);
    expect(
      isValidPolygonal(
        polygon([
          [0, 0],
          [1, 0],
          [0, 0]
        ])
      )
    ).toBe(false);
  });
});

describe('发给后端的几何：简化', () => {
  it('最多 120 个坐标，容差依次是 0、¼、½、1、2 个像素', () => {
    expect(QUERY_VERTEX_LIMIT).toBe(120);
    expect(SIMPLIFY_PIXELS).toStrictEqual([0, 0.25, 0.5, 1, 2]);
  });

  it('不超过 120 个坐标时只舍入，不简化', () => {
    const area = circle(100, 0.05);

    expect(queryGeometry(area, 0.0001)).toStrictEqual(roundPolygonal(area));
  });

  it('超过 120 个时简化到不超过 120 个，原来的边界离简化后的不超过 2 个像素', () => {
    const area = circle(400, 0.05);
    const pixel = 0.0001;
    const result = queryGeometry(area, pixel);
    if (result?.type !== 'Polygon') {
      throw new Error('应当得到一个多边形');
    }

    expect(vertexCount(result)).toBeLessThanOrEqual(QUERY_VERTEX_LIMIT);
    expect(isValidPolygonal(result)).toBe(true);
    expect(maxDeviation(area.coordinates[0] ?? [], result.coordinates[0] ?? [])).toBeLessThanOrEqual(2 * pixel + 1e-6);
  });

  it('某次简化的结果自相交时不用它：南通市界和框求交后，前三档容差的结果都无效，用第四档的', () => {
    const area = clipToScope(box(120.2, 32.2, 120.7, 32.6), nantong());
    if (!area) {
      throw new Error('框和南通应当相交');
    }
    // 评审复现的情况：求交结果本身有效，按 0.006 度简化后不到 120 个坐标，但外环自相交
    const first = roundPolygonal(simplify(area, { tolerance: 0.006 * 0.25, highQuality: true }));
    expect(first && vertexCount(first)).toBeLessThanOrEqual(QUERY_VERTEX_LIMIT);
    expect(first && isValidPolygonal(first)).toBe(false);

    const result = queryGeometry(area, 0.006);
    expect(result && isValidPolygonal(result)).toBe(true);
    expect(result).toStrictEqual(roundPolygonal(simplify(area, { tolerance: 0.006 * 2, highQuality: true })));
  });

  it('压不下来时为 null（范围太复杂）：31 个独立的小方形至少 155 个坐标；不知道像素大小时只试不简化的', () => {
    const squares = multi(...Array.from({ length: 31 }, (_, index) => [square(120 + index * 0.01, 32, 0.005)]));

    expect(queryGeometry(squares, 0.001)).toBeNull();
    expect(queryGeometry(circle(400, 0.05), null)).toBeNull();
    expect(queryGeometry(circle(100, 0.05), null)).toStrictEqual(roundPolygonal(circle(100, 0.05)));
  });
});
