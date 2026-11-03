import type { AreaCoverage, CoverRelation } from '@/shared/map/area/area-coverage';
import type { AreaProblemCode } from '@/shared/map/area/area-geometry';
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
  /** 区县的面积（平方千米） */
  readonly total: number;
  /** 占区县面积的比例：全部覆盖的是 1（计算时按整个区县） */
  readonly ratio: number;
}

/** 一个市的覆盖：全部区县都全部覆盖时是全部覆盖 */
export interface CityCover {
  readonly code: string;
  readonly name: string;
  readonly relation: CoverRelation;
  readonly area: number;
  /** 全市的面积 */
  readonly total: number;
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
  readonly province: {
    readonly relation: CoverRelation;
    readonly area: number;
    readonly total: number;
    readonly ratio: number;
  };
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
                total: district.area,
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
        total,
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
      total: provinceArea,
      ratio: whole ? 1 : Math.min(1, coverage.coveredArea / provinceArea)
    },
    cities,
    touches: coverage.touches.map(touch => ({ code: touch.code, name: atlas.get(touch.code).name, area: touch.area })),
    full,
    partial
  };
}

/** 省、市、区县一行的面积和占比 */
export interface CoverMeasure {
  readonly area: number;
  readonly total: number;
  readonly ratio: number;
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

/** 上级一行的提示：下面的区县按覆盖方式计数，如"部分 5""完整 1 · 部分 2" */
export const coverCounts = ({ full, partial }: { readonly full: number; readonly partial: number }): string =>
  [full > 0 && `完整 ${full}`, partial > 0 && `部分 ${partial}`].filter(Boolean).join(' · ');

/** 标签的悬浮提示：范围内的面积 / 行政区的面积（占比），如"50 km² / 100 km²（50%）" */
export const coverDetail = ({ area, total, ratio }: CoverMeasure): string =>
  `${formatKm2(area)} km² / ${formatKm2(total)} km²（${formatRatio(ratio)}）`;

const cityName = (code: string) => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code;

const namesOf = (list: readonly { readonly name: string }[]) => list.map(item => item.name).join('、');

/** AI 的一句话摘要：范围在哪，区县少时写出各自怎么覆盖，多时只写个数；各覆盖几个在下面的筛选里，面积在卡片里 */
export function areaSummary(tree: CoverageTree): string {
  const { cities } = tree;
  const where =
    cities.length === 1
      ? `位于${cities[0]?.name ?? ''}`
      : `跨${cities.length <= 3 ? namesOf(cities) : `${cities[0]?.name ?? ''}等 ${cities.length} 个市`}`;
  const districts = cities.flatMap(city => city.districts);
  if (districts.length > 4) {
    return `范围${where}，涉及 ${districts.length} 个区县。`;
  }
  const full = districts.filter(item => item.relation === 'full');
  const partial = districts.filter(item => item.relation === 'partial');
  const detail = [full.length > 0 && `${namesOf(full)}完整覆盖`, partial.length > 0 && `${namesOf(partial)}部分覆盖`]
    .filter(Boolean)
    .join('，');
  return `范围${where}，${detail}。`;
}

/** 影响计算结果、要让用户看到的提示：省外的面积不参与计算 */
export function coverageNotices(coverage: AreaCoverage): string[] {
  if (coverage.outsideArea <= 0) {
    return [];
  }
  const most = coverage.outsideArea > coverage.area / 2 ? '，范围的大部分在省外' : '';
  return [`范围有 ${formatKm2(coverage.outsideArea)} 平方千米在江苏省外，不参与计算${most}`];
}

const PROBLEM_TEXT: Readonly<Record<AreaProblemCode, string>> = {
  'file-type': '不支持这种文件，请上传 GeoJSON 或 Shapefile',
  'file-size': '文件太大，请精简后重新上传',
  'file-empty': '文件里没有可用的范围，请检查后重新上传',
  'file-corrupt': '文件无法读取，请检查后重新上传',
  'file-parts': 'Shapefile 的文件不完整，建议打包成 .zip 后上传',
  crs: '文件的坐标系不支持，请转换为经纬度坐标后上传',
  'geometry-type': '文件里没有面，不能作为范围',
  'geometry-invalid': '范围不是有效的面，请重新绘制或上传',
  'too-complex': '范围太复杂，请精简后重新上传',
  'too-small': '范围太小，请重新绘制或上传',
  'too-large': '范围太大，请缩小后重新绘制或上传',
  outside: '范围不在江苏省内，请检查后重新绘制或上传'
};

/** 不能用的原因写给用户看的话：说清楚怎么办；具体的技术原因收在"查看原因"里（ADR 0131） */
export const problemText = (code: AreaProblemCode): string => PROBLEM_TEXT[code];

/** 范围卡片上的两行说明：涉及的市和区县，面积 */
export function areaBrief(area: ScopeArea): { readonly where: string; readonly size: string } {
  const { covers } = area.coverage;
  const names = area.cityCodes.map(code => shortRegionName(cityName(code)));
  const cities = names.length <= 3 ? names.join('、') : `${names.slice(0, 2).join('、')}等 ${names.length} 个市`;
  return {
    where: `${cities} · ${covers.length} 个区县`,
    size: `${formatKm2(area.coverage.area)} km²`
  };
}
