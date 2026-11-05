import { geodesicArea, type LngLat, type ViewBounds } from '@yzt/map-core';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { districtsOf, JIANGSU_CITIES, type Region } from '@/shared/map/region/region-catalog';
import type { RegionBoundary, RegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { cached } from './cache';

/** 推演用的一个区县：区划目录的名称和所在市，加上从县界算出的面积、中心和范围 */
export interface District {
  readonly code: string;
  readonly name: string;
  readonly cityCode: string;
  /** 市辖区（名称以"区"结尾）：人口更密、覆盖率略高 */
  readonly urban: boolean;
  /** 面积（平方千米），椭球面上计算（ADR 0035） */
  readonly area: number;
  /** 撒设施点的中心：最大一块外环的顶点平均位置 */
  readonly center: LngLat;
  readonly bounds: ViewBounds;
  readonly geometry: Polygon | MultiPolygon;
}

/** 一个区县的区划条目和县界（由 shared/map/region 的边界加载器给出） */
export interface DistrictShape {
  readonly region: Region;
  readonly boundary: RegionBoundary;
}

/** 推演范围内的全部区县 */
export interface DistrictAtlas {
  readonly all: readonly District[];
  /** 按代码取区县；没有时抛错 */
  get(code: string): District;
  /** 若干市的区县，按目录顺序；同一组市只筛一次 */
  inCities(cityCodes: readonly string[]): readonly District[];
}

const toLngLat = ([lng = 0, lat = 0]: Position): LngLat => [lng, lat];
const ringArea = (ring: readonly Position[]) => geodesicArea(ring.map(toLngLat)) / 1e6;

function summarize({ region, boundary }: DistrictShape): District {
  const polygons =
    boundary.geometry.type === 'Polygon' ? [boundary.geometry.coordinates] : boundary.geometry.coordinates;
  let area = 0;
  let largest: { area: number; ring: readonly Position[] } = { area: -1, ring: [] };
  for (const [outer = [], ...holes] of polygons) {
    const outerArea = ringArea(outer);
    area += outerArea - holes.reduce((sum, hole) => sum + ringArea(hole), 0);
    if (outerArea > largest.area) {
      largest = { area: outerArea, ring: outer };
    }
  }
  // 首尾是同一个点，只算一次
  const vertices = largest.ring.slice(0, -1).map(toLngLat);
  const center: LngLat = [
    vertices.reduce((sum, [lng]) => sum + lng, 0) / vertices.length,
    vertices.reduce((sum, [, lat]) => sum + lat, 0) / vertices.length
  ];
  return {
    code: region.code,
    name: region.name,
    cityCode: region.cityCode,
    urban: region.name.endsWith('区'),
    area,
    center,
    bounds: boundary.bounds,
    geometry: boundary.geometry
  };
}

/** 从区县的区划条目和县界算出推演用的区县 */
export function createDistrictAtlas(shapes: readonly DistrictShape[]): DistrictAtlas {
  const all = shapes.map(summarize);
  const byCode = new Map(all.map(district => [district.code, district]));
  const inCities = cached(
    (cityCodes: readonly string[]) => all.filter(district => cityCodes.includes(district.cityCode)),
    cityCodes => cityCodes.join(',')
  );
  return {
    all,
    get(code) {
      const district = byCode.get(code);
      if (!district) {
        throw new Error(`计算范围里没有区县 ${code}`);
      }
      return district;
    },
    inCities
  };
}

/** 用边界加载器取全省 95 个区县的县界，建推演范围 */
export async function loadDistrictAtlas(loader: Pick<RegionBoundaryLoader, 'load'>): Promise<DistrictAtlas> {
  const regions = JIANGSU_CITIES.flatMap(city => districtsOf(city.code));
  const shapes = await Promise.all(regions.map(async region => ({ region, boundary: await loader.load(region) })));
  return createDistrictAtlas(shapes);
}
