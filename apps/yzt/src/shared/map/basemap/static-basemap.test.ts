// @vitest-environment node
import { type Feature, featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { StyleModel } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import cityFile from '../boundary/data/jiangsu-city.json?raw';
import countyFile from '../boundary/data/jiangsu-county.json?raw';
import { districtsOf, JIANGSU_CITIES } from '../region/region-catalog';
import { boundaryCode } from '../region/region-geometry';
import labelsFile from './data/jiangsu-labels.json?raw';
import thumbnailFile from './images/static-thumbnail.svg?raw';
import { STATIC_LAND_COLOR, STATIC_OUTSIDE_COLOR } from './static-palette';
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

describe('分组', () => {
  it('地名：区县和市两层，市名在上；数据是本地文件', () => {
    const { sources, layers } = staticLabelsGroup(1);
    const source = sources['basemap-labels-static'];

    expect(layers.map(({ id, type }) => [id, type])).toStrictEqual([
      ['basemap-labels-static-county', 'symbol'],
      ['basemap-labels-static-city', 'symbol']
    ]);
    expect(source?.type === 'geojson' ? source.data : '').toMatch(/^(?!https?:).*jiangsu-labels[^/]*\.json/);
  });

  it('ID 以所在分组的名称为前缀，组合后通过样式模型的校验', () => {
    const base = staticBasemapGroup(1);
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
    const { sources, layers } = staticBasemapGroup(1);
    const source = sources['basemap-static'];

    expect(layers.map(({ id, type }) => [id, type])).toStrictEqual([
      ['basemap-background', 'background'],
      ['basemap-static-land', 'fill'],
      ['basemap-static-line', 'line']
    ]);
    expect(source?.type === 'geojson' ? source.data : '').toMatch(/^(?!https?:).*jiangsu-city[^/]*\.json/);
  });

  it('颜色已经换算好，滑块 100% 时面完全不透明', () => {
    expect(paintOf(staticBasemapGroup(1).layers, 'basemap-static-land')).toMatchObject({ 'fill-opacity': 1 });
  });

  it('滑块的透明度作用于面、线（乘在 90% 上）和地名，底色不变', () => {
    const { layers } = staticBasemapGroup(0.5);
    const labelLayers = staticLabelsGroup(0.5).layers;

    expect(paintOf(layers, 'basemap-background')).toStrictEqual({ 'background-color': '#E6EAF0' });
    expect(paintOf(layers, 'basemap-static-land')).toMatchObject({ 'fill-opacity': 0.5 });
    expect(paintOf(layers, 'basemap-static-line')).toMatchObject({ 'line-opacity': 0.45 });
    expect(paintOf(labelLayers, 'basemap-labels-static-city')).toMatchObject({ 'text-opacity': 0.5 });
    expect(paintOf(labelLayers, 'basemap-labels-static-county')).toMatchObject({ 'text-opacity': 0.5 });
  });

  it('面只取面要素：MapLibre 的类型 3、GeoJSON 原来的 Polygon 和 MultiPolygon（南京）都留下', () => {
    const land = staticBasemapGroup(1).layers.find(layer => layer.id === 'basemap-static-land');
    const { filter } = featureFilter(land && 'filter' in land ? land.filter : undefined, 'basemap-static-land.filter');
    const accepts = (type: Feature['type']) => filter({ zoom: 8 }, { type, properties: {} });

    expect(accepts('Polygon')).toBe(true);
    expect(accepts('MultiPolygon')).toBe(true);
    expect(accepts(3)).toBe(true);
    expect(accepts('LineString')).toBe(false);
  });
});

describe('陆地的颜色', () => {
  it('原色 #F7F3E6（CREAM）按 75% 叠在省外底色上是 #F3F1E9，陆地用的是它', () => {
    expect(blendAt75('#F7F3E6', STATIC_OUTSIDE_COLOR)).toBe('#F3F1E9');
    expect(STATIC_LAND_COLOR).toBe('#F3F1E9');
  });

  it('全省一种颜色，不按市取色', () => {
    expect(paintOf(staticBasemapGroup(1).layers, 'basemap-static-land')).toMatchObject({
      'fill-color': STATIC_LAND_COLOR
    });
  });

  it('缩略图和当前的配色对得上，也不带透明度（改了要运行 basemap:generate）', () => {
    const fills = new Set([...thumbnailFile.matchAll(/<path fill="(#[0-9A-Fa-f]{6})"/g)].map(match => match[1]));

    expect(thumbnailFile).toContain(`fill="${STATIC_OUTSIDE_COLOR}"`);
    expect(thumbnailFile).not.toContain('opacity');
    expect(fills).toStrictEqual(new Set([STATIC_LAND_COLOR]));
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
