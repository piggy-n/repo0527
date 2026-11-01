import type { ViewBounds } from '@yzt/map-core';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon, Position } from 'geojson';
import { polygonsOf } from '@/shared/map/area/area-geometry';
import { JIANGSU_BOUNDS } from '@/shared/map/jiangsu';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { polygonBounds } from '@/shared/map/region/region-geometry';
import { indicatorResult, valueBreaks } from '../model/analysis';
import type { Calculator, DistrictResult } from '../model/calculator';
import type { District } from '../model/districts';
import { facilityLayoutOf } from '../model/facilities';
import { serviceMeters, type SimulationConditions, type SimulationParams } from '../model/params';
import { scopeCityCodes, scopeDistricts, type ScopedDistrict } from '../model/scope';
import { PENDING_COLOR, valueColor } from './colors';

/** 区县要素的属性：动画只换图层里的阈值，比较的是这里的排序（0～1） */
export interface DistrictProperties {
  readonly code: string;
  readonly cityCode: string;
  /** 人口密度底色的不透明度 */
  readonly density: number;
  /** 所在市在推演范围里的先后：人口按市逐个点亮 */
  readonly cityRank: number;
  /** 中心经度在推演范围里从西到东的位置：计算时扫描带按它经过 */
  readonly lngRank: number;
  /** 所选指标、年度和着色下的颜色 */
  readonly fill: string;
}

/** 城市标注：位置、名称、所选指标的值，以及放大到这个市时的范围 */
export interface MapCity {
  readonly code: string;
  readonly name: string;
  readonly center: readonly [number, number];
  readonly bounds: ViewBounds;
  readonly value: number;
}

/** 一轮推演在地图上要用的数据：条件和参数不变时不变 */
export interface MapData {
  readonly districts: FeatureCollection<Polygon | MultiPolygon, DistrictProperties>;
  /** 推演范围以外，盖上遮罩：行政区划是范围外的区县，自定义范围是范围以外的一切 */
  readonly mask: FeatureCollection<Polygon | MultiPolygon>;
  /** 自定义范围的边界；行政区划时为 null */
  readonly area: MultiPolygon | null;
  /** 主指标的设施点：rank 是离第一个市中心由近到远的位置，落点按它出现 */
  readonly facilities: FeatureCollection<Point, { readonly rank: number }>;
  /** 主指标的服务范围（米，旧规程下是站点的 300 米）；人均类为 0 */
  readonly ringMeters: number;
  /** 推演范围的外包框 */
  readonly bounds: ViewBounds;
  /** 城市标注：位置、名称、主指标的值 */
  readonly cities: readonly MapCity[];
  /** 空间分析的样例区县 */
  readonly sample: District | null;
}


/** 一组外包框合起来的外包框 */
function unionBounds(list: readonly ViewBounds[]): ViewBounds {
  let [west, south, east, north] = [180, 90, -180, -90];
  for (const bounds of list) {
    west = Math.min(west, bounds[0]);
    south = Math.min(south, bounds[1]);
    east = Math.max(east, bounds[2]);
    north = Math.max(north, bounds[3]);
  }
  return [west, south, east, north];
}

/** 一组区县的外包框 */
export const districtBounds = (districts: readonly District[]): ViewBounds =>
  unionBounds(districts.map(district => district.bounds));

// 范围里的部分的外包框：自定义范围部分覆盖的区县只算范围内的部分
const scopedBounds = (list: readonly ScopedDistrict[]): ViewBounds =>
  unionBounds(
    list.map(({ district, share, geometry }) => (share < 1 ? polygonBounds(polygonsOf(geometry)) : district.bounds))
  );

// 标注的位置：最大一块外环的顶点平均位置（同区县的撒点中心），部分覆盖的区县取范围内的部分
function labelPoint({ district, share, geometry }: ScopedDistrict): readonly [number, number] {
  if (share >= 1) {
    return district.center;
  }
  const rings = polygonsOf(geometry).map(([outer = []]) => outer);
  const largest = rings.reduce((best, ring) => (ring.length > best.length ? ring : best), rings[0] ?? []);
  const vertices = largest.slice(0, -1);
  const mean = (axis: 0 | 1) =>
    vertices.reduce((sum, point) => sum + (point[axis] ?? 0), 0) / Math.max(1, vertices.length);
  return [mean(0), mean(1)];
}

// 按值从小到大的位置 0～1；只有一个时为 0
function ranks<T>(items: readonly T[], value: (item: T) => number): Map<T, number> {
  const sorted = items.toSorted((a, b) => value(a) - value(b));
  const last = Math.max(1, sorted.length - 1);
  return new Map(sorted.map((item, index) => [item, index / last]));
}

const feature = <G extends Feature['geometry'], P>(geometry: G, properties: P): Feature<G, P> => ({
  type: 'Feature',
  geometry,
  properties
});

// 环的方向：经纬度平面上按鞋带公式，逆时针为正
const signedArea = (ring: readonly Position[]): number =>
  ring.reduce((sum, [x1 = 0, y1 = 0], index) => {
    const [x2 = 0, y2 = 0] = ring[(index + 1) % ring.length] ?? [];
    return sum + (x1 * y2 - x2 * y1);
  }, 0) / 2;
const oriented = (ring: readonly Position[], counterClockwise: boolean): Position[] =>
  signedArea(ring) > 0 === counterClockwise ? [...ring] : ring.toReversed();

// 外扩的江苏范围（度）：自定义范围以外的遮罩画到这里为止
const MASK_MARGIN = 3;

/**
 * 自定义范围以外的遮罩：外扩的江苏范围挖掉范围的各块外环，范围里的洞另作遮罩。
 * MapLibre 按第一个环的方向区分外环和洞，外环逆时针、洞顺时针
 */
export function maskAround(area: MultiPolygon): FeatureCollection<Polygon | MultiPolygon> {
  const [west, south, east, north] = JIANGSU_BOUNDS;
  const frame: Position[] = [
    [west - MASK_MARGIN, south - MASK_MARGIN],
    [east + MASK_MARGIN, south - MASK_MARGIN],
    [east + MASK_MARGIN, north + MASK_MARGIN],
    [west - MASK_MARGIN, north + MASK_MARGIN],
    [west - MASK_MARGIN, south - MASK_MARGIN]
  ];
  const outers = area.coordinates.map(([outer = []]) => oriented(outer, false));
  const holes = area.coordinates.flatMap(([, ...inner]) => inner.map(ring => [oriented(ring, true)]));
  const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: [[oriented(frame, true), ...outers], ...holes] };
  return { type: 'FeatureCollection', features: [feature(geometry, {})] };
}

/** 结果展示可以换年度、换着色；不传时是最新年度、按数值分级 */
export interface MapDataOptions {
  readonly year?: number;
  /** 区县的颜色；不传时按五档数值分级 */
  readonly fill?: (row: DistrictResult) => string;
}

/** 结果展示的地图数据；同样的输入得到同样的数据。自定义范围只画范围内的部分（ADR 0121） */
export function mapData(
  calculator: Calculator,
  conditions: SimulationConditions,
  params: SimulationParams,
  primary: string,
  options: MapDataOptions = {}
): MapData {
  const year = options.year ?? Math.max(...conditions.years);
  const { atlas } = calculator;
  const { scope } = conditions;
  const cityCodes = scopeCityCodes(scope);
  const scoped = scopeDistricts(atlas, scope);
  const result = indicatorResult(calculator.computeYear(conditions, params, year).indicators, primary);
  const rows = new Map(result.rows.map(row => [row.code, row]));
  const breaks = valueBreaks(calculator, conditions, primary);
  const fill = options.fill ?? ((row: DistrictResult) => valueColor(row.value, breaks));
  const density = (district: District) => calculator.districtPopulation(district) / district.area;
  const densities = new Map(scoped.map(({ district }) => [district.code, density(district)]));
  const maxDensity = Math.max(...densities.values(), 1);
  const lngRanks = ranks(scoped, item => labelPoint(item)[0]);
  const lastCity = Math.max(1, cityCodes.length - 1);
  const cityRanks = new Map(cityCodes.map((code, index) => [code, index / lastCity]));

  const districts = scoped.map(item => {
    const { district } = item;
    const row = rows.get(district.code);
    return feature(item.geometry, {
      code: district.code,
      cityCode: district.cityCode,
      density: 0.12 + 0.4 * Math.sqrt((densities.get(district.code) ?? 0) / maxDensity),
      cityRank: cityRanks.get(district.cityCode) ?? 0,
      lngRank: lngRanks.get(item) ?? 0,
      fill: row ? fill(row) : PENDING_COLOR
    });
  });

  // 设施点：离第一个区县的中心由近到远
  const [first] = scoped;
  const anchor: readonly [number, number] = first ? labelPoint(first) : [0, 0];
  const points = facilityLayoutOf(calculator).points(conditions, primary, year);
  const distance = ([lng = 0, lat = 0]: readonly number[]) => (lng - anchor[0]) ** 2 + (lat - anchor[1]) ** 2;
  const pointRanks = ranks(points, point => distance(point.coordinates));

  // 样例：第一个市里人口最密的市辖区（和叙述一致）
  const firstCity = scoped.filter(({ district }) => district.cityCode === cityCodes[0]).map(({ district }) => district);
  const urban = firstCity.filter(district => district.urban).toSorted((a, b) => density(b) - density(a));
  const area = scope.kind === 'area' ? (scope.area?.geometry ?? null) : null;

  return {
    districts: { type: 'FeatureCollection', features: districts },
    mask: area
      ? maskAround(area)
      : {
          type: 'FeatureCollection',
          features: atlas.all
            .filter(district => !cityCodes.includes(district.cityCode))
            .map(district => feature(district.geometry, {}))
        },
    area,
    facilities: {
      type: 'FeatureCollection',
      features: points.map(point =>
        feature({ type: 'Point', coordinates: [...point.coordinates] }, { rank: pointRanks.get(point) ?? 0 })
      )
    },
    ringMeters: serviceMeters(primary, params) ?? 0,
    bounds: scopedBounds(scoped),
    cities: result.cities.map(city => {
      const members = scoped.filter(({ district }) => district.cityCode === city.code);
      const centers = members.map(labelPoint);
      const center: [number, number] = [
        centers.reduce((sum, [lng]) => sum + lng, 0) / Math.max(1, centers.length),
        centers.reduce((sum, [, lat]) => sum + lat, 0) / Math.max(1, centers.length)
      ];
      const name = JIANGSU_CITIES.find(item => item.code === city.code)?.name ?? city.name;
      return {
        code: city.code,
        name,
        center,
        bounds: scopedBounds(members),
        value: city.value
      };
    }),
    sample: urban[0] ?? firstCity[0] ?? null
  };
}
