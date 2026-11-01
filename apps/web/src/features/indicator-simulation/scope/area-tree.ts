import type { AreaCoverage, CoverRelation } from '@/shared/map/area/area-coverage';
import { JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import type { DistrictAtlas } from '../model/districts';
import type { ScopeArea } from '../model/scope';

// AI 范围分析的展示数据（ADR 0121）：按省、市、县分级，筛选、搜索，摘要和提示都是纯函数

/** 一个区县的覆盖 */
export interface DistrictCover {
  readonly code: string;
  readonly name: string;
  readonly relation: CoverRelation;
  /** 范围内的面积（平方千米） */
  readonly area: number;
  /** 占区县面积的比例：全部覆盖的是 1（计算时按整个区县） */
  readonly ratio: number;
}

/** 一个市的覆盖：全部区县都全部覆盖时是全部覆盖 */
export interface CityCover {
  readonly code: string;
  readonly name: string;
  readonly relation: CoverRelation;
  readonly area: number;
  /** 占全市面积的比例 */
  readonly ratio: number;
  readonly full: number;
  readonly partial: number;
  readonly districts: readonly DistrictCover[];
}

/** 只与范围边界相交、不算覆盖的区县 */
export interface TouchedDistrict {
  readonly code: string;
  readonly name: string;
  readonly area: number;
}

export interface CoverageTree {
  /** 江苏省：所有区县都全部覆盖时是全部覆盖 */
  readonly province: { readonly relation: CoverRelation; readonly area: number; readonly ratio: number };
  readonly cities: readonly CityCover[];
  readonly touches: readonly TouchedDistrict[];
  readonly full: number;
  readonly partial: number;
}

/** 按省、市、县整理覆盖分析：市按区划目录，市里的区县按范围内的面积从大到小 */
export function coverageTree(coverage: AreaCoverage, atlas: DistrictAtlas): CoverageTree {
  const covers = new Map(coverage.covers.map(cover => [cover.code, cover]));
  const cities = JIANGSU_CITIES.flatMap((city): CityCover[] => {
    const members = atlas.inCities([city.code]);
    const districts = members
      .flatMap((district): DistrictCover[] => {
        const cover = covers.get(district.code);
        return cover
          ? [
              {
                code: district.code,
                name: district.name,
                relation: cover.relation,
                area: cover.area,
                ratio: cover.relation === 'full' ? 1 : cover.ratio
              }
            ]
          : [];
      })
      .toSorted((a, b) => b.area - a.area);
    if (districts.length === 0) {
      return [];
    }
    const full = districts.filter(item => item.relation === 'full').length;
    const area = districts.reduce((sum, item) => sum + item.area, 0);
    const total = members.reduce((sum, district) => sum + district.area, 0);
    // 面积按求交量出来，全部覆盖时也可能差一点点不到 1，直接写 1
    const whole = full === members.length;
    return [
      {
        code: city.code,
        name: city.name,
        relation: whole ? 'full' : 'partial',
        area,
        ratio: whole ? 1 : Math.min(1, area / total),
        full,
        partial: districts.length - full,
        districts
      }
    ];
  });
  const full = cities.reduce((sum, city) => sum + city.full, 0);
  const partial = cities.reduce((sum, city) => sum + city.partial, 0);
  const provinceArea = atlas.all.reduce((sum, district) => sum + district.area, 0);
  const whole = full === atlas.all.length;
  return {
    province: {
      relation: whole ? 'full' : 'partial',
      area: coverage.coveredArea,
      ratio: whole ? 1 : Math.min(1, coverage.coveredArea / provinceArea)
    },
    cities,
    touches: coverage.touches.map(touch => ({ code: touch.code, name: atlas.get(touch.code).name, area: touch.area })),
    full,
    partial
  };
}

/** 列表的筛选：全部、全部覆盖、部分覆盖 */
export type CoverFilter = 'all' | CoverRelation;

/**
 * 按覆盖方式和关键字筛选：市名含关键字时列出它符合覆盖方式的区县，否则只列名称含关键字的区县；
 * 没有符合的区县的市不列
 */
export function filterTree(tree: CoverageTree, filter: CoverFilter, keyword: string): CityCover[] {
  const text = keyword.trim();
  return tree.cities.flatMap(city => {
    const cityHit = text === '' || city.name.includes(text);
    const districts = city.districts.filter(
      district => (filter === 'all' || district.relation === filter) && (cityHit || district.name.includes(text))
    );
    return districts.length > 0 ? [{ ...city, districts }] : [];
  });
}

/** 列表一开始是否展开所有市：市和区县都不多时展开，多时只列各市（ADR 0121） */
export const expandAllByDefault = (tree: CoverageTree): boolean =>
  tree.cities.length <= 2 && tree.full + tree.partial <= 12;

/** 面积（平方千米）：不到 1 时两位小数，不到 100 时一位，再大取整并加千分位 */
export function formatKm2(value: number): string {
  if (value < 1) {
    return value.toFixed(2);
  }
  return value.toLocaleString('zh-CN', { maximumFractionDigits: value < 100 ? 1 : 0 });
}

/** 比例写成百分数：不到 10% 一位小数，不到 1% 写"<1%"；不满 100% 的不进位成 100% */
export function formatRatio(ratio: number): string {
  if (ratio >= 1) {
    return '100%';
  }
  if (ratio < 0.01) {
    return ratio > 0 ? '<1%' : '0%';
  }
  const percent = ratio * 100;
  return `${percent >= 10 ? Math.min(99, Math.round(percent)) : percent.toFixed(1)}%`;
}

const cityName = (code: string) => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code;

const namesOf = (list: readonly { readonly name: string }[]) => list.map(item => item.name).join('、');

/** AI 的一段摘要：范围在哪、多大，涉及几个区县，哪些全部覆盖、哪些部分覆盖（区县多时只写个数） */
export function areaSummary(tree: CoverageTree, coverage: AreaCoverage): string {
  const { cities } = tree;
  const where =
    cities.length === 1
      ? `位于${cities[0]?.name ?? ''}`
      : `跨${cities.length <= 3 ? namesOf(cities) : `${cities[0]?.name ?? ''}等`} ${cities.length} 个市`;
  const districts = cities.flatMap(city => city.districts);
  const full = districts.filter(item => item.relation === 'full');
  const partial = districts.filter(item => item.relation === 'partial');
  let detail: string;
  if (districts.length <= 4) {
    detail = [full.length > 0 && `${namesOf(full)}全部覆盖`, partial.length > 0 && `${namesOf(partial)}部分覆盖`]
      .filter(Boolean)
      .join('，');
  } else if (full.length === 0) {
    detail = '均为部分覆盖';
  } else if (partial.length === 0) {
    detail = '均为全部覆盖';
  } else {
    detail = `${full.length <= 3 ? namesOf(full) : `${full.length} 个区县`}全部覆盖，其余 ${partial.length} 个部分覆盖`;
  }
  const tail = partial.length > 0 ? '计算时，部分覆盖的区县按范围内的面积占比折算人口和用地。' : '';
  const inside = coverage.outsideArea > 0 ? `（省内 ${formatKm2(coverage.coveredArea)}）` : '';
  return `范围${where}，面积 ${formatKm2(coverage.area)} 平方千米${inside}，涉及 ${districts.length} 个区县：${detail}。${tail}`;
}

/** 覆盖分析的提示：省外的面积、大部分在省外、只沿边界相交的区县 */
export function coverageNotices(tree: CoverageTree, coverage: AreaCoverage): string[] {
  const notices: string[] = [];
  if (coverage.outsideArea > 0) {
    const most = coverage.outsideArea > coverage.area / 2 ? '，范围的大部分在省外' : '';
    notices.push(`范围有 ${formatKm2(coverage.outsideArea)} 平方千米在江苏省外，不参与计算${most}`);
  }
  if (tree.touches.length > 0) {
    const { touches } = tree;
    const names = touches.length <= 3 ? namesOf(touches) : `${touches[0]?.name ?? ''}等 ${touches.length} 个区县`;
    notices.push(`${names}只与范围的边界相交（细条或不足 1 公顷），不算覆盖`);
  }
  return notices;
}

/** 范围卡片上的两行说明：涉及的市和区县（部分覆盖的个数），面积 */
export function areaBrief(area: ScopeArea): { readonly where: string; readonly size: string } {
  const { covers } = area.coverage;
  const partial = covers.filter(cover => cover.relation === 'partial').length;
  const names = area.cityCodes.map(code => shortRegionName(cityName(code)));
  const cities = names.length <= 3 ? names.join('、') : `${names.slice(0, 2).join('、')}等 ${names.length} 个市`;
  return {
    where: `${cities} · ${covers.length} 个区县${partial > 0 ? `（部分 ${partial}）` : ''}`,
    size: `${formatKm2(area.coverage.area)} km²`
  };
}
