import catalog from './data/jiangsu-regions.json';

export type RegionLevel = 'city' | 'district';

/** 区划目录里的一个市或区县（ADR 0036）；没有选择就是全省 */
export interface Region {
  /** 6 位行政区划代码 */
  readonly code: string;
  readonly name: string;
  readonly level: RegionLevel;
  /** 所在的市；市就是它自己 */
  readonly cityCode: string;
}

/** 搜索最多给出的条数，与旧项目一致 */
const SEARCH_LIMIT = 20;

const CITIES: readonly Region[] = catalog.map(({ code, name }) => ({ code, name, level: 'city', cityCode: code }));

const DISTRICTS = new Map<string, readonly Region[]>(
  catalog.map(({ code: cityCode, districts }) => [
    cityCode,
    districts.map(({ code, name }) => ({ code, name, level: 'district', cityCode }))
  ])
);

// 目录顺序：每个市后面跟着它的区县，搜索结果按这个顺序排列
const ALL_REGIONS: readonly Region[] = CITIES.flatMap(city => [city, ...districtsOf(city.code)]);

const BY_CODE = new Map(ALL_REGIONS.map(region => [region.code, region]));

/** 江苏的 13 个市，顺序沿用旧项目 */
export const JIANGSU_CITIES = CITIES;

/** 某个市的区县；不是市的代码时为空 */
export function districtsOf(cityCode: string): readonly Region[] {
  return DISTRICTS.get(cityCode) ?? [];
}

export function findRegion(code: string): Region | undefined {
  return BY_CODE.get(code);
}

/** 区划的路径，如"南京市 / 玄武区"；市只有自己的名称 */
export function regionPath(region: Region): string {
  if (region.level === 'city') {
    return region.name;
  }
  return `${findRegion(region.cityCode)?.name ?? ''} / ${region.name}`;
}

/** 去掉名称末尾的"市"，如"南京市"显示为"南京" */
export function shortRegionName(name: string): string {
  return name.replace(/市$/, '');
}

/**
 * 搜索：路径包含关键字的区划，按目录顺序，最多 20 条。旧项目把完全相同的排在前面，是因为"江苏省"一项包含所有关键字；
 * 目录里没有这一项，完全相同的本来就排在最前
 */
export function searchRegions(keyword: string): Region[] {
  const text = keyword.trim();
  if (!text) {
    return [];
  }
  return ALL_REGIONS.filter(region => regionPath(region).includes(text)).slice(0, SEARCH_LIMIT);
}
