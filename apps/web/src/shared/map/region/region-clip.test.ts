// @vitest-environment node
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { type StyleGroup, StyleModel } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import cityFile from '../boundary/data/jiangsu-city.json?raw';
import cityUrl from '../boundary/data/jiangsu-city.json?url';
import countyFile from '../boundary/data/jiangsu-county.json?raw';
import countyUrl from '../boundary/data/jiangsu-county.json?url';
import { districtsOf, JIANGSU_CITIES } from './region-catalog';
import { clipMask, regionClipGroup, regionRings } from './region-clip';
import { createRegionBoundaryLoader, type RegionBoundary } from './region-geometry';

const WORLD = [
  [-180, -85.051129],
  [180, -85.051129],
  [180, 85.051129],
  [-180, 85.051129],
  [-180, -85.051129]
];

// 逆时针的正方形
function square(x: number, y: number, size: number): Position[] {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y]
  ];
}

const clockwise = (ring: Position[]) => ring.toReversed();

function masked(geometry: Polygon | MultiPolygon, point: Position): boolean {
  return booleanPointInPolygon(point, clipMask(geometry));
}

function compose(group: StyleGroup) {
  const model = new StyleModel({ groups: ['selection', 'region-clip', 'basemap-labels'] });
  model.setGroups({ 'region-clip': group });
  return model.current;
}

const OUTER = square(0, 0, 10);
const HOLE = square(2, 2, 6);
const ISLAND = square(3, 3, 4);
const ISLAND_HOLE = square(4, 4, 2);
const INNER_ISLAND = square(4.5, 4.5, 1);

const BOUNDARY: RegionBoundary = {
  code: '320213',
  geometry: { type: 'Polygon', coordinates: [OUTER] },
  bounds: [0, 0, 10, 10]
};

describe('区划裁剪的遮罩', () => {
  it('区划是整个世界的洞：世界的外环逆时针，区划的环顺时针', () => {
    expect(clipMask({ type: 'Polygon', coordinates: [OUTER] }).coordinates).toStrictEqual([[WORLD, clockwise(OUTER)]]);
  });

  it('不管数据原来是什么方向，结果都一样', () => {
    const fromClockwise = clipMask({ type: 'Polygon', coordinates: [clockwise(OUTER), HOLE] });
    const fromCounterClockwise = clipMask({ type: 'Polygon', coordinates: [OUTER, clockwise(HOLE)] });

    expect(fromClockwise).toStrictEqual(fromCounterClockwise);
    expect(fromClockwise.coordinates).toStrictEqual([[WORLD, clockwise(OUTER)], [HOLE]]);
  });

  it('区划的洞被盖住；洞里属于区划的小岛不被盖住，再深一层也对', () => {
    const geometry: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[OUTER, HOLE], [ISLAND, ISLAND_HOLE], [INNER_ISLAND]]
    };

    expect(clipMask(geometry).coordinates).toStrictEqual([
      [WORLD, clockwise(OUTER)],
      [HOLE, clockwise(ISLAND)],
      [ISLAND_HOLE, clockwise(INNER_ISLAND)]
    ]);
    expect(masked(geometry, [20, 20])).toBe(true);
    expect(masked(geometry, [1, 1])).toBe(false);
    expect(masked(geometry, [2.5, 2.5])).toBe(true);
    expect(masked(geometry, [3.5, 3.5])).toBe(false);
    expect(masked(geometry, [4.2, 4.2])).toBe(true);
    expect(masked(geometry, [5, 5])).toBe(false);
  });

  it('只看环的嵌套，不看数据把它标成外环还是洞', () => {
    const asHole = clipMask({ type: 'Polygon', coordinates: [OUTER, HOLE] });
    const asPart = clipMask({ type: 'MultiPolygon', coordinates: [[OUTER], [HOLE]] });

    expect(asPart).toStrictEqual(asHole);
  });

  it('相接的顶点不参与判断：和外环相接的洞仍在里面，和别的部分相接的部分仍在外面', () => {
    const touchingHole = [
      [0, 0],
      [3, 1],
      [1, 3],
      [0, 0]
    ];
    const touchingPart = square(10, 10, 5);
    const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: [[OUTER, touchingHole], [touchingPart]] };

    // 只按点判断看不出洞挂错了地方（判断点用奇偶规则），MapLibre 却画不对，所以也比较结构
    expect(clipMask(geometry).coordinates).toStrictEqual([
      [WORLD, clockwise(OUTER), clockwise(touchingPart)],
      [touchingHole]
    ]);
    expect(masked(geometry, [1.2, 1.2])).toBe(true);
    expect(masked(geometry, [5, 5])).toBe(false);
    expect(masked(geometry, [12, 12])).toBe(false);
  });

  it('没有边界时是空分组', () => {
    expect(regionClipGroup(null)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('遮罩放进 region-clip 数据源：不透明，关掉抗锯齿，只画面', () => {
    expect(regionClipGroup(BOUNDARY)).toStrictEqual({
      sources: {
        'region-clip': {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: clipMask(BOUNDARY.geometry) }
        }
      },
      layers: [
        {
          id: 'region-clip-mask',
          type: 'fill',
          source: 'region-clip',
          filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
          paint: { 'fill-color': '#F3F5F8', 'fill-opacity': 1, 'fill-antialias': false }
        }
      ]
    });
  });

  it('ID 以分组名为前缀，组合后通过校验；每次推导的数据都是新对象', () => {
    const first = regionClipGroup(BOUNDARY);
    const second = regionClipGroup(BOUNDARY);

    expect(() => compose(first)).not.toThrow();
    expect(first.sources['region-clip']).not.toBe(second.sources['region-clip']);
  });
});

describe('本地边界数据满足遮罩的前提', () => {
  const files = new Map([
    [cityUrl, cityFile],
    [countyUrl, countyFile]
  ]);
  const loader = createRegionBoundaryLoader(url => Promise.resolve(JSON.parse(files.get(url) ?? 'null')));
  const regions = [...JIANGSU_CITIES, ...JIANGSU_CITIES.flatMap(city => districtsOf(city.code))];

  it('同一个区划的每两个环，要么互不包含，要么一个的全部顶点都在另一个里面', async () => {
    const boundaries = await Promise.all(regions.map(region => loader.load(region)));
    const violations: string[] = [];
    for (const [regionIndex, { geometry }] of boundaries.entries()) {
      const name = regions[regionIndex]?.name;
      const rings = regionRings(geometry);
      for (const [index, ring] of rings.entries()) {
        for (const [otherIndex, other] of rings.entries()) {
          const polygon: Polygon = { type: 'Polygon', coordinates: [other] };
          const inside = ring.filter(vertex => booleanPointInPolygon(vertex, polygon, { ignoreBoundary: true }));
          if (otherIndex !== index && inside.length > 0 && inside.length < ring.length) {
            violations.push(`${name} 第 ${index} 个环有 ${inside.length}/${ring.length} 个顶点在第 ${otherIndex} 个环里`);
          }
        }
      }
    }

    expect(violations).toStrictEqual([]);
  });
});
