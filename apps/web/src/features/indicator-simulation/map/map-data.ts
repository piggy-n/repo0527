import type { ViewBounds } from '@yzt/map-core';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { indicatorResult, type PassState, passState, valueBreaks } from '../model/analysis';
import type { Calculator, DistrictResult } from '../model/calculator';
import type { District } from '../model/districts';
import { facilityLayoutOf } from '../model/facilities';
import { serviceMeters, type SimulationConditions, type SimulationParams } from '../model/params';
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
  /** 主指标在最新年度的颜色 */
  readonly fill: string;
  /** 没有达到目标值（评价分级时闪烁） */
  readonly fail: boolean;
  /** 人工干预预览：改了参数后达标状态会变（结果阶段描虚线） */
  readonly preview: boolean;
}

/** 城市标注：位置、名称、主指标的值与达标 */
export interface MapCity {
  readonly code: string;
  readonly name: string;
  readonly center: readonly [number, number];
  readonly value: number;
  readonly state: PassState;
}

/** 一轮推演在地图上要用的数据：条件和参数不变时不变 */
export interface MapData {
  readonly districts: FeatureCollection<Polygon | MultiPolygon, DistrictProperties>;
  /** 推演范围以外的区县，盖上遮罩 */
  readonly mask: FeatureCollection<Polygon | MultiPolygon>;
  /** 主指标的设施点：rank 是离第一个市中心由近到远的位置，落点按它出现 */
  readonly facilities: FeatureCollection<Point, { readonly rank: number }>;
  /** 主指标的服务范围（米，旧规程下是站点的 300 米）；人均类为 0 */
  readonly ringMeters: number;
  /** 推演范围的外包框 */
  readonly bounds: ViewBounds;
  /** 城市标注：位置、名称、主指标的值与达标 */
  readonly cities: readonly MapCity[];
  /** 空间分析的样例区县 */
  readonly sample: District | null;
}

/** 一组区县的外包框 */
export function districtBounds(districts: readonly District[]): ViewBounds {
  let [west, south, east, north] = [180, 90, -180, -90];
  for (const { bounds } of districts) {
    west = Math.min(west, bounds[0]);
    south = Math.min(south, bounds[1]);
    east = Math.max(east, bounds[2]);
    north = Math.max(north, bounds[3]);
  }
  return [west, south, east, north];
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

/** 结果阶段可以换年度、换着色、标出预览的区县；推演时是最新年度、按数值分级 */
export interface MapDataOptions {
  readonly year?: number;
  /** 区县的颜色；不传时按五档数值分级 */
  readonly fill?: (row: DistrictResult) => string;
  readonly preview?: ReadonlySet<string>;
}

/** 一轮推演（或结果阶段看的一版）的地图数据；同样的输入得到同样的数据 */
export function mapData(
  calculator: Calculator,
  conditions: SimulationConditions,
  params: SimulationParams,
  primary: string,
  options: MapDataOptions = {}
): MapData {
  const year = options.year ?? Math.max(...conditions.years);
  const { atlas } = calculator;
  const scope = atlas.inCities(conditions.cityCodes);
  const result = indicatorResult(calculator.computeYear(conditions, params, year).indicators, primary);
  const rows = new Map(result.rows.map(row => [row.code, row]));
  const breaks = valueBreaks(calculator, conditions, primary);
  const fill = options.fill ?? ((row: DistrictResult) => valueColor(row.value, breaks));
  const density = (district: District) => calculator.districtPopulation(district) / district.area;
  const densities = new Map(scope.map(district => [district.code, density(district)]));
  const maxDensity = Math.max(...densities.values(), 1);
  const lngRanks = ranks(scope, district => district.center[0]);
  const lastCity = Math.max(1, conditions.cityCodes.length - 1);
  const cityRanks = new Map(conditions.cityCodes.map((code, index) => [code, index / lastCity]));

  const districts = scope.map(district => {
    const row = rows.get(district.code);
    return feature(district.geometry, {
      code: district.code,
      cityCode: district.cityCode,
      density: 0.12 + 0.4 * Math.sqrt((densities.get(district.code) ?? 0) / maxDensity),
      cityRank: cityRanks.get(district.cityCode) ?? 0,
      lngRank: lngRanks.get(district) ?? 0,
      fill: row ? fill(row) : PENDING_COLOR,
      fail: row !== undefined && !row.pass,
      preview: options.preview?.has(district.code) ?? false
    });
  });

  // 设施点：离第一个市的中心由近到远
  const [first] = scope;
  const anchor = first?.center ?? [0, 0];
  const points = facilityLayoutOf(calculator).points(conditions, primary, year);
  const distance = ([lng = 0, lat = 0]: readonly number[]) => (lng - anchor[0]) ** 2 + (lat - anchor[1]) ** 2;
  const pointRanks = ranks(points, point => distance(point.coordinates));

  // 样例：第一个市里人口最密的市辖区（和叙述一致）
  const firstCity = atlas.inCities(conditions.cityCodes.slice(0, 1));
  const urban = firstCity.filter(district => district.urban).toSorted((a, b) => density(b) - density(a));

  return {
    districts: { type: 'FeatureCollection', features: districts },
    mask: {
      type: 'FeatureCollection',
      features: atlas.all
        .filter(district => !conditions.cityCodes.includes(district.cityCode))
        .map(district => feature(district.geometry, {}))
    },
    facilities: {
      type: 'FeatureCollection',
      features: points.map(point =>
        feature({ type: 'Point', coordinates: [...point.coordinates] }, { rank: pointRanks.get(point) ?? 0 })
      )
    },
    ringMeters: serviceMeters(primary, params) ?? 0,
    bounds: districtBounds(scope),
    cities: result.cities.map(city => {
      const members = scope.filter(district => district.cityCode === city.code);
      const center: [number, number] = [
        members.reduce((sum, district) => sum + district.center[0], 0) / Math.max(1, members.length),
        members.reduce((sum, district) => sum + district.center[1], 0) / Math.max(1, members.length)
      ];
      const name = JIANGSU_CITIES.find(item => item.code === city.code)?.name ?? city.name;
      return { code: city.code, name, center, value: city.value, state: passState(city.value, result.target) };
    }),
    sample: urban[0] ?? firstCity[0] ?? null
  };
}
