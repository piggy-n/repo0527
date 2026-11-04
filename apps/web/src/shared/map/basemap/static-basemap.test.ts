// @vitest-environment node
import { type ExpressionSpecification, type Feature, featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import cityFile from '../boundary/data/jiangsu-city.json?raw';
import countyFile from '../boundary/data/jiangsu-county.json?raw';
import { districtsOf, JIANGSU_CITIES } from '../region/region-catalog';
import { boundaryCode } from '../region/region-geometry';
import labelsFile from './data/jiangsu-labels.json?raw';
import thumbnailFile from './images/static-thumbnail.svg?raw';
import { STATIC_CITY_COLORS, STATIC_OUTSIDE_COLOR } from './static-palette';
import { staticBasemapGroup, staticLabelsGroup } from './static-basemap';

type Ring = readonly (readonly [number, number])[];

interface RegionFile {
  readonly features: readonly {
    readonly properties: { readonly code: string; readonly name: string };
    readonly geometry: { readonly type: 'Polygon'; readonly coordinates: readonly Ring[] } | {
      readonly type: 'MultiPolygon';
      readonly coordinates: readonly (readonly Ring[])[];
    };
  }[];
}

interface LabelFile {
  readonly features: readonly {
    readonly properties: { readonly code: string; readonly name: string; readonly level: string };
    readonly geometry: { readonly coordinates: readonly [number, number] };
  }[];
}

const cities = JSON.parse(cityFile) as RegionFile;
const counties = JSON.parse(countyFile) as RegionFile;
const labels = JSON.parse(labelsFile) as LabelFile;

const polygonsOf = ({ geometry }: RegionFile['features'][number]): readonly (readonly Ring[])[] =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

function pointInRings(rings: readonly Ring[], [lng, lat]: readonly [number, number]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[i + 1];
      if (ay > lat !== by > lat && lng < ax + ((lat - ay) / (by - ay)) * (bx - ax)) {
        inside = !inside;
      }
    }
  }
  return inside;
}

const vertexKey = ([lng, lat]: readonly [number, number]) => `${lng},${lat}`;

// 某一级地名的代码和名称，代码换算成区划目录的 6 位
const labelEntries = (level: string) =>
  new Map(
    labels.features
      .filter(({ properties }) => properties.level === level)
      .map(({ properties }) => [boundaryCode(properties.code), properties.name])
  );

describe('各市的配色', () => {
  it('市界数据里的每个市都有颜色，也没有多余的市', () => {
    const codes = new Set(cities.features.map(({ properties }) => properties.code));

    expect(new Set(Object.keys(STATIC_CITY_COLORS))).toStrictEqual(codes);
  });

  it('相邻的市颜色不同：市界的共用边顶点完全一致，按共用顶点判断相邻', () => {
    const owners = new Map<string, Set<string>>();
    for (const feature of cities.features) {
      for (const point of polygonsOf(feature).flat(2)) {
        const key = vertexKey(point);
        owners.set(key, (owners.get(key) ?? new Set()).add(feature.properties.code));
      }
    }
    const shared = new Map<string, number>();
    for (const codes of owners.values()) {
      const [first, second] = [...codes];
      if (codes.size >= 2 && first && second) {
        const pair = [first, second].toSorted().join('-');
        shared.set(pair, (shared.get(pair) ?? 0) + 1);
      }
    }
    const neighbours = [...shared.keys()].map(pair => pair.split('-'));

    // 13 个市至少有这么多对相邻：数据变了、顶点不再一致时这条会先失败
    expect(neighbours.length).toBeGreaterThan(20);
    const conflicts = neighbours.filter(([a = '', b = '']) => STATIC_CITY_COLORS[a] === STATIC_CITY_COLORS[b]);
    expect(conflicts).toStrictEqual([]);
  });

  it('样式按 code 取色，每个市都写进表达式', () => {
    const land = staticBasemapGroup(1).layers.find(layer => layer.id === 'basemap-static-land');
    const color = land?.paint && 'fill-color' in land.paint ? (land.paint['fill-color'] as ExpressionSpecification) : null;

    expect(color?.slice(0, 2)).toStrictEqual(['match', ['get', 'code']]);
    for (const [code, value] of Object.entries(STATIC_CITY_COLORS)) {
      expect(color).toContain(code);
      expect(color).toContain(value);
    }
  });

  it('面只取面要素，三维按原来的类型求值时 MultiPolygon（南京）也要留下', () => {
    const land = staticBasemapGroup(1).layers.find(layer => layer.id === 'basemap-static-land');
    const { filter } = featureFilter(land && 'filter' in land ? land.filter : undefined, 'basemap-static-land.filter');
    const accepts = (type: Feature['type']) => filter({ zoom: 8 }, { type, properties: {} });

    expect(accepts('Polygon')).toBe(true);
    expect(accepts('MultiPolygon')).toBe(true);
    expect(accepts(3)).toBe(true);
    expect(accepts('LineString')).toBe(false);
  });

  it('缩略图用同一套配色，文件和配色对得上（改了配色要运行 basemap:generate）', () => {
    expect(thumbnailFile).toContain(`fill="${STATIC_OUTSIDE_COLOR}"`);
    for (const color of new Set(Object.values(STATIC_CITY_COLORS))) {
      expect(thumbnailFile).toContain(`fill="${color}"`);
    }
  });
});

describe('地名数据', () => {
  it('和区划目录逐条对应：13 个市、95 个区县，代码和名称都相同', () => {
    const districts = JIANGSU_CITIES.flatMap(city => districtsOf(city.code));

    expect(labelEntries('city')).toStrictEqual(new Map(JIANGSU_CITIES.map(({ code, name }) => [code, name])));
    expect(labelEntries('county')).toStrictEqual(new Map(districts.map(({ code, name }) => [code, name])));
  });

  it('名称只有汉字：其他字符会向 glyphs 的地址请求字形，而这个地址不存在（ADR 0133）', () => {
    const others = labels.features.map(({ properties }) => properties.name).filter(name => !/^\p{Script=Han}+$/u.test(name));

    expect(others).toStrictEqual([]);
  });

  it('每个地名都落在自己的行政区里面', () => {
    const regions = new Map<string, (readonly Ring[])[]>();
    for (const feature of [...cities.features, ...counties.features]) {
      regions.set(feature.properties.code, [...(regions.get(feature.properties.code) ?? []), ...polygonsOf(feature)]);
    }

    const outside = labels.features
      .filter(({ properties, geometry }) => {
        const polygons = regions.get(properties.code) ?? [];
        return !polygons.some(rings => pointInRings(rings, geometry.coordinates));
      })
      .map(({ properties }) => properties.name);

    expect(outside).toStrictEqual([]);
  });

  it('区县的地名在 8.5 级才出现，市名一直在；各图层只取自己这一级', () => {
    const [county, city] = staticLabelsGroup(1).layers;

    expect(county?.minzoom).toBe(8.5);
    expect(city?.minzoom).toBeUndefined();
    expect(county && 'filter' in county ? county.filter : null).toStrictEqual(['==', ['get', 'level'], 'county']);
    expect(city && 'filter' in city ? city.filter : null).toStrictEqual(['==', ['get', 'level'], 'city']);
  });
});
