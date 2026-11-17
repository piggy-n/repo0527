import { z } from 'zod';
import type { DashboardData } from '@/shared/dashboard/model';
import data from './land-space-2025.json';

// 数据由 pnpm --filter yzt land-space:data 从《指标汇总.xlsx》生成，不手改

/** 一级的 id，与一级图标 dashboard-<id> 对应 */
export const LAND_SPACE_DOMAIN_IDS = [
  'livability',
  'public-resources',
  'public-services',
  'urban-safety',
  'transport',
  'building'
] as const;

export type LandSpaceDomainId = (typeof LAND_SPACE_DOMAIN_IDS)[number];

/** 唯一的数据年份 */
export const LAND_SPACE_YEAR = 2025;

/** 三级指标的分项（如交通干线便捷度的"与一级公路之间距离"）；不带分项的值是"综合" */
export interface LandSpacePart {
  readonly id: string;
  readonly name: string;
}

/** 三级指标：「指标字典」里的单一指标 */
export interface LandSpaceIndicator {
  readonly id: string;
  /** 名称末尾和单位相同的括号已去掉（城乡职住用地比例） */
  readonly name: string;
  /** 「无量纲」已换成空字符串；单位为 % 的值是百分数（57.48） */
  readonly unit: string;
  /** 数字格式显示的小数位，0.00% 是 2 */
  readonly precision: number;
  readonly parts: readonly LandSpacePart[];
}

/** 二级：名称是「二级分类」，值是 indexId 对应的二级指数 */
export interface LandSpaceSubIndex {
  readonly id: string;
  readonly name: string;
  readonly indexId: string;
  /** 指数在「指标字典」里的名称，如"福利设施便利性指数" */
  readonly indexName: string;
  readonly unit: string;
  readonly precision: number;
  /** 原报告没有列这个二级指数的值（体育活动便利性、养老便利性、城乡融合水平） */
  readonly hasValues: boolean;
  readonly indicators: readonly LandSpaceIndicator[];
}

/** 一级：名称是「一级分类」，值是 indexId 对应的一级指数 */
export interface LandSpaceDomain {
  readonly id: LandSpaceDomainId;
  readonly name: string;
  readonly indexId: string;
  readonly indexName: string;
  readonly unit: string;
  readonly precision: number;
  readonly subIndices: readonly LandSpaceSubIndex[];
}

/** 驾驶舱公共的读值接口，另加全省值；value 的第三个参数是值的 id（见 partValueId） */
export interface LandSpaceData extends DashboardData {
  province(valueId: string): number | null;
}

interface LandSpaceFile {
  readonly source: string;
  readonly year: number;
  readonly domains: readonly LandSpaceDomain[];
  readonly values: Readonly<Record<string, Readonly<Record<string, number | null>>>>;
  readonly province: Readonly<Record<string, number>>;
}

const precisionSchema = z.number().int().min(0);

const indicatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  precision: precisionSchema,
  parts: z.array(z.object({ id: z.string(), name: z.string() }))
});

const subIndexSchema = z.object({
  id: z.string(),
  name: z.string(),
  indexId: z.string(),
  indexName: z.string(),
  unit: z.string(),
  precision: precisionSchema,
  hasValues: z.boolean(),
  // 选二级时连带选它的第一个三级
  indicators: z.array(indicatorSchema).min(1)
});

const fileSchema: z.ZodType<LandSpaceFile> = z.object({
  source: z.string(),
  year: z.literal(LAND_SPACE_YEAR),
  domains: z.array(
    z.object({
      id: z.enum(LAND_SPACE_DOMAIN_IDS),
      name: z.string(),
      indexId: z.string(),
      indexName: z.string(),
      unit: z.string(),
      precision: precisionSchema,
      subIndices: z.array(subIndexSchema).min(1)
    })
  ),
  values: z.record(z.string(), z.record(z.string(), z.number().nullable())),
  province: z.record(z.string(), z.number())
});

// 模块加载时校验一次：生成的文件和这里的类型对不上时直接报错，不带着错的结构往下走
const file = fileSchema.parse(data);

// 查值用 Map，值的 id 碰上 Object.prototype 的属性名也不会取错
const VALUES: ReadonlyMap<string, ReadonlyMap<string, number | null>> = new Map(
  Object.entries(file.values).map(([valueId, byCity]) => [valueId, new Map(Object.entries(byCity))])
);
const PROVINCE: ReadonlyMap<string, number> = new Map(Object.entries(file.province));

/** 6 个一级，顺序同「指标字典」 */
export const LAND_SPACE_DOMAINS: readonly LandSpaceDomain[] = file.domains;

/** 值的 id：分项为 null（综合）时就是指标编码，否则是"编码:分项" */
export function partValueId(indicatorId: string, partId: string | null): string {
  return partId === null ? indicatorId : `${indicatorId}:${partId}`;
}

/** 2025 年各市的值和全省值；值的 id 是指数编码、指标编码或 partValueId 的结果，没有的值为 null */
export const LAND_SPACE_DATA: LandSpaceData = {
  years: [LAND_SPACE_YEAR],
  value(year, cityCode, valueId) {
    if (year !== LAND_SPACE_YEAR) {
      return null;
    }
    return VALUES.get(valueId)?.get(cityCode) ?? null;
  },
  province(valueId) {
    return PROVINCE.get(valueId) ?? null;
  }
};
