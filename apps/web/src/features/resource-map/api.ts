import { z } from 'zod';
import { http } from '@/shared/http/client';

// 结构按 2026-10-09、10-11 实测的返回确定（docs/migration.md）；resource（所属分类名）与分类路径重复，不声明
const resourceLayerSchema = z.object({
  code: z.string(),
  name: z.string(),
  geoType: z.enum(['Polygon', 'Line', 'Point']),
  // 升序，至少一年；后端按"图层 × 年份"逐条返回，同一个 code 会重复出现
  yearList: z.array(z.number().int()).nonempty()
});

export type ResourceTreeLayer = z.infer<typeof resourceLayerSchema>;

/** 分类节点：都带 children（可能为空），图层节点没有；有的分类 code 是 null */
export interface ResourceTreeCategory {
  readonly code: string | null;
  readonly name: string;
  readonly children: readonly ResourceTreeNode[];
}

export type ResourceTreeNode = ResourceTreeCategory | ResourceTreeLayer;

const resourceCategorySchema: z.ZodType<ResourceTreeCategory> = z.object({
  code: z.string().nullable(),
  name: z.string(),
  // 有没有 children 区分分类和图层：先按分类解析，没有 children 的才是图层
  get children() {
    return z.array(z.union([resourceCategorySchema, resourceLayerSchema]));
  }
});

/** 现状底图的资源树（ADR 0041）：顶层是基础库、公共库、主题库、三区三线四个分组 */
export function fetchResourceTree(signal?: AbortSignal) {
  return http.get('/resource-map/base/tree', { schema: z.array(resourceCategorySchema), signal });
}
