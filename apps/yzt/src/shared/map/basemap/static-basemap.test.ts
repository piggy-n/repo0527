// @vitest-environment node
import { type ExpressionSpecification, type Feature, featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { overlayDetailLimit, StyleModel } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import cityFile from '../boundary/data/jiangsu-city.json?raw';
import countyFile from '../boundary/data/jiangsu-county.json?raw';
import { districtsOf, JIANGSU_CITIES } from '../region/region-catalog';
import { boundaryCode } from '../region/region-geometry';
import labelsFile from './data/jiangsu-labels.json?raw';
import thumbnailFile from './images/static-thumbnail.svg?raw';
import { STATIC_BASEMAP_OPTIONS, type StaticBasemapOptions } from './static-options';
import {
  STATIC_CITY_COLORS,
  STATIC_LAND_COLOR,
  STATIC_OUTSIDE_COLOR,
  staticCityColors
} from './static-palette';
import { staticBasemapGroup, staticLabelsGroup } from './static-basemap';

// 用例自己固定开关：改默认值只影响"默认关闭"那一条
const ALL_ON: StaticBasemapOptions = { cityColors: true };
const ALL_OFF: StaticBasemapOptions = { cityColors: false };

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

const channels = (hex: string) => [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16));

// 原色按 75% 叠在背景色上换算成不透明的 HEX
function blendAt75(color: string, background: string): string {
  const under = channels(background);
  const mixed = channels(color).map((value, index) => Math.round(0.75 * value + 0.25 * (under[index] ?? 0)));
  return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

// 分组里某个图层的绘制属性
const paintOf = (layers: ReturnType<typeof staticBasemapGroup>['layers'], id: string) =>
  layers.find(layer => layer.id === id)?.paint;

describe('开关', () => {
  it('默认关闭分色；不传选项时按默认值', () => {
    expect(STATIC_BASEMAP_OPTIONS).toStrictEqual(ALL_OFF);
    expect(staticBasemapGroup(1)).toStrictEqual(staticBasemapGroup(1, STATIC_BASEMAP_OPTIONS));
  });

  it('地名：区县和市两层，市名在上；数据是本地文件', () => {
    const { sources, layers } = staticLabelsGroup(1);
    const source = sources['basemap-labels-static'];

    expect(layers.map(({ id, type }) => [id, type])).toStrictEqual([
      ['basemap-labels-static-county', 'symbol'],
      ['basemap-labels-static-city', 'symbol']
    ]);
    expect(source?.type === 'geojson' ? source.data : '').toMatch(/^(?!https?:).*jiangsu-labels[^/]*\.json/);
  });

  it('关闭分色：全省一种颜色（CREAM），不按市取色', () => {
    const { layers } = staticBasemapGroup(1, ALL_OFF);

    expect(STATIC_LAND_COLOR).toBe('#F3F1E9');
    expect(paintOf(layers, 'basemap-static-land')).toMatchObject({ 'fill-color': STATIC_LAND_COLOR });
    expect(new Set(Object.values(staticCityColors(false)))).toStrictEqual(new Set([STATIC_LAND_COLOR]));
    expect(Object.keys(staticCityColors(false))).toStrictEqual(Object.keys(STATIC_CITY_COLORS));
  });

  it('打开分色：缩略图按各市的颜色画', () => {
    expect(staticCityColors(true)).toBe(STATIC_CITY_COLORS);
  });

  it('打开全部开关时，ID 以所在分组的名称为前缀，组合后通过样式模型的校验', () => {
    const base = staticBasemapGroup(1, ALL_ON);
    const named = staticLabelsGroup(1);
    const model = new StyleModel({ groups: ['basemap', 'basemap-labels'] });

    expect(() => model.setGroups({ basemap: base, 'basemap-labels': named })).not.toThrow();
    for (const id of [...Object.keys(base.sources), ...base.layers.map(layer => layer.id)]) {
      expect(id).toMatch(/^basemap-(?!labels-)/);
    }
    for (const id of [...Object.keys(named.sources), ...named.layers.map(layer => layer.id)]) {
      expect(id).toMatch(/^basemap-labels-/);
    }
    model[Symbol.dispose]();
  });
});

describe('面、线和透明度', () => {
  it('省外的底色、市界数据上的面和线；数据是本地文件', () => {
    const { sources, layers } = staticBasemapGroup(1, ALL_OFF);
    const source = sources['basemap-static'];

    expect(layers.map(({ id, type }) => [id, type])).toStrictEqual([
      ['basemap-background', 'background'],
      ['basemap-static-land', 'fill'],
      ['basemap-static-line', 'line']
    ]);
    expect(source?.type === 'geojson' ? source.data : '').toMatch(/^(?!https?:).*jiangsu-city[^/]*\.json/);
  });

  it.each([ALL_OFF, ALL_ON])('颜色已经换算好，滑块 100% 时面完全不透明（%j）', options => {
    expect(paintOf(staticBasemapGroup(1, options).layers, 'basemap-static-land')).toMatchObject({ 'fill-opacity': 1 });
  });

  it('三维的面和线到 11 级不再加细，靠近模型时不重建全省的几何（ADR 0135）', () => {
    const { layers } = staticBasemapGroup(1, ALL_OFF);
    const limit = (id: string) => overlayDetailLimit(layers.find(layer => layer.id === id)?.metadata);

    expect(limit('basemap-static-land')).toBe(11);
    expect(limit('basemap-static-line')).toBe(11);
  });

  it('滑块的透明度作用于面、线（乘在 90% 上）和地名，底色不变', () => {
    const { layers } = staticBasemapGroup(0.5, ALL_ON);
    const labelLayers = staticLabelsGroup(0.5).layers;

    expect(paintOf(layers, 'basemap-background')).toStrictEqual({ 'background-color': '#E6EAF0' });
    expect(paintOf(layers, 'basemap-static-land')).toMatchObject({ 'fill-opacity': 0.5 });
    expect(paintOf(layers, 'basemap-static-line')).toMatchObject({ 'line-opacity': 0.45 });
    expect(paintOf(labelLayers, 'basemap-labels-static-city')).toMatchObject({ 'text-opacity': 0.5 });
    expect(paintOf(labelLayers, 'basemap-labels-static-county')).toMatchObject({ 'text-opacity': 0.5 });
  });
});

describe('各市的配色', () => {
  it.each([
    ['#F7F3E6', '#F3F1E9'],
    ['#F0F3E4', '#EEF1E7'],
    ['#F6EEE3', '#F2EDE6'],
    ['#ECF2E9', '#EBF0EB']
  ])('原色 %s 按 75%% 叠在省外底色上是 %s，配色表里用的是它', (original, blended) => {
    expect(blendAt75(original, STATIC_OUTSIDE_COLOR)).toBe(blended);
    expect(Object.values(STATIC_CITY_COLORS)).toContain(blended);
  });

  it('配色表只用这四种不透明的 HEX，没有带透明度的写法', () => {
    expect(new Set(Object.values(STATIC_CITY_COLORS))).toStrictEqual(
      new Set(['#F3F1E9', '#EEF1E7', '#F2EDE6', '#EBF0EB'])
    );
  });

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

  it('打开分色时样式按 code 取色，每个市都写进表达式', () => {
    const land = staticBasemapGroup(1, ALL_ON).layers.find(layer => layer.id === 'basemap-static-land');
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

  it('缩略图和当前的配色、开关对得上，也不带透明度（改了要运行 basemap:generate）', () => {
    const fills = new Set([...thumbnailFile.matchAll(/<path fill="(#[0-9A-Fa-f]{6})"/g)].map(match => match[1]));

    expect(thumbnailFile).toContain(`fill="${STATIC_OUTSIDE_COLOR}"`);
    expect(thumbnailFile).not.toContain('opacity');
    expect(fills).toStrictEqual(new Set(Object.values(staticCityColors(STATIC_BASEMAP_OPTIONS.cityColors))));
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
