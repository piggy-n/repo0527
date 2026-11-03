import type { MultiPolygon, Polygon } from 'geojson';
import type { AreaCoverage, CoverRelation } from '@/shared/map/area/area-coverage';
import type { AreaFormat } from '@/shared/map/area/area-file';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import type { District, DistrictAtlas } from './districts';

/** 自定义范围：上传或绘制、确定时已经分析好覆盖（ADR 0121），计算和显示直接用 */
export interface ScopeArea {
  readonly name: string;
  readonly source: 'upload' | 'draw';
  /** 上传的文件名和格式；绘制时为 null */
  readonly file: { readonly name: string; readonly format: AreaFormat } | null;
  readonly geometry: MultiPolygon;
  /** 缩略图的轮廓 */
  readonly outline: MultiPolygon;
  readonly coverage: AreaCoverage;
  /** 涉及的市，按区划目录的顺序 */
  readonly cityCodes: readonly string[];
  /** 范围内面积占各涉及市面积的比例：结果排行显示，不参与计算；市的区县都完整覆盖时是 1 */
  readonly cityRatios: Readonly<Record<string, number>>;
}

/** 监测范围：所选的市，或自定义范围（还没有上传、绘制时为 null） */
export type SimulationScope =
  | { readonly kind: 'cities'; readonly cityCodes: readonly string[] }
  | { readonly kind: 'area'; readonly area: ScopeArea | null };

export type ScopeKind = SimulationScope['kind'];

export const citiesScope = (cityCodes: readonly string[]): SimulationScope => ({ kind: 'cities', cityCodes });
export const areaScope = (area: ScopeArea | null): SimulationScope => ({ kind: 'area', area });

/** 计算范围涉及的市：行政区划是所选的市，自定义范围是范围涉及的市（还没有范围时为空） */
export function scopeCityCodes(scope: SimulationScope): readonly string[] {
  if (scope.kind === 'cities') {
    return scope.cityCodes;
  }
  return scope.area?.cityCodes ?? [];
}

/** 用在说明里的名称，如"自定义范围「江宁片区」" */
export const areaLabel = (area: ScopeArea): string => `自定义范围「${area.name}」`;

// 范围内面积占这个市面积的比例：面积按求交量出来，都完整覆盖时也可能差一点点不到 1，直接写 1
function cityRatio(atlas: DistrictAtlas, cityCode: string, coverage: AreaCoverage): number {
  const members = atlas.inCities([cityCode]);
  const covers = new Map(coverage.covers.map(cover => [cover.code, cover]));
  if (members.every(district => covers.get(district.code)?.relation === 'full')) {
    return 1;
  }
  const area = members.reduce((sum, district) => sum + (covers.get(district.code)?.area ?? 0), 0);
  const total = members.reduce((sum, district) => sum + district.area, 0);
  return Math.min(1, area / total);
}

/** 由覆盖分析建自定义范围：涉及的市按区划目录排序 */
export function createScopeArea(atlas: DistrictAtlas, input: Omit<ScopeArea, 'cityCodes' | 'cityRatios'>): ScopeArea {
  const touched = new Set(input.coverage.covers.map(cover => atlas.get(cover.code).cityCode));
  const cityCodes = JIANGSU_CITIES.map(city => city.code).filter(code => touched.has(code));
  const cityRatios = Object.fromEntries(cityCodes.map(code => [code, cityRatio(atlas, code, input.coverage)]));
  return { ...input, cityCodes, cityRatios };
}

/** 范围里的一个区县：整个区县，或自定义范围里的一部分 */
export interface ScopedDistrict {
  readonly district: District;
  /** 范围内面积占区县面积的比例；行政区划、全部覆盖时为 1 */
  readonly share: number;
  readonly relation: CoverRelation;
  /** 范围内的部分；行政区划时是整个区县 */
  readonly geometry: Polygon | MultiPolygon;
}

// 同一个自定义范围的区县只建一次（按区县表分开：测试里可能有几份）
const areaDistricts = new WeakMap<DistrictAtlas, WeakMap<ScopeArea, readonly ScopedDistrict[]>>();

/** 范围里的区县，按区划目录的顺序；范围是空的时抛错。全部覆盖的区县按整个区县算 */
export function scopeDistricts(atlas: DistrictAtlas, scope: SimulationScope): readonly ScopedDistrict[] {
  if (scope.kind === 'cities') {
    if (scope.cityCodes.length === 0) {
      throw new Error('计算条件里没有城市');
    }
    return atlas.inCities(scope.cityCodes).map(district => ({
      district,
      share: 1,
      relation: 'full',
      geometry: district.geometry
    }));
  }
  const { area } = scope;
  if (!area) {
    throw new Error('计算条件里没有自定义范围');
  }
  let byArea = areaDistricts.get(atlas);
  if (!byArea) {
    byArea = new WeakMap();
    areaDistricts.set(atlas, byArea);
  }
  let list = byArea.get(area);
  if (!list) {
    list = area.coverage.covers.map(cover => {
      const district = atlas.get(cover.code);
      const full = cover.relation === 'full';
      return {
        district,
        share: full ? 1 : cover.ratio,
        relation: cover.relation,
        geometry: full ? district.geometry : cover.geometry
      };
    });
    byArea.set(area, list);
  }
  return list;
}
