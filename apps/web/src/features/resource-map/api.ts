import type { Geometry, MultiPolygon, Point, Polygon } from 'geojson';
import { z } from 'zod';
import { http } from '@/shared/http/client';
import { guidCondition, queryFeatureGeometries } from '@/shared/map/feature-geometry';

export { geometrySchema } from '@/shared/map/geometry-schema';
export { guidCondition, isFeatureGuid, queryFeatureGeometries } from '@/shared/map/feature-geometry';

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

/** 现状底图的资源树（ADR 0041）：顶层是基础库、公共库、主题库、三区三线四个分组；失败由资源列表显示并重试，不弹全局提示 */
export function fetchResourceTree(signal?: AbortSignal) {
  return http.get('/resource-map/base/tree', { schema: z.array(resourceCategorySchema), signal, silent: true });
}

// 要素查询接口（ADR 0047 第 8 节）：成功时没有信封，失败时返回信封；结构按 2026-10-14 实测确定（docs/migration.md）

/** 查询接口返回的一条记录：字段按资源不同，由调用方按需读取 */
const featureRecordSchema = z.record(z.string(), z.unknown());

export type FeatureRecord = z.infer<typeof featureRecordSchema>;

// 分页插件的返回还有 pageNum、pages 等字段，用不到
const featurePageSchema = z.object({ total: z.number(), list: z.array(featureRecordSchema) });

export type FeaturePage = z.infer<typeof featurePageSchema>;

// 属性查询要带行政区，查全省
const PROVINCE_CODE = '320000';

/** 和这个点或范围相交的要素（只有属性），分页；图层编码是"资源编码_年份" */
export function queryFeaturesAt(
  layerCode: string,
  geometry: Point | Polygon | MultiPolygon,
  { pageNum, pageSize }: { readonly pageNum: number; readonly pageSize: number },
  signal?: AbortSignal
) {
  const query = { layerCode, geometry: JSON.stringify(geometry), relation: 'INTERSECTS', pageNum, pageSize };
  return http.get('/api/query/scope/geojson/page', {
    schema: featurePageSchema,
    envelope: false,
    silent: true,
    query,
    signal
  });
}

/** 按 guid 查属性 */
export function queryFeatureAttributes(layerCode: string, guid: string, signal?: AbortSignal) {
  const query = { layerCode, xzqdm: PROVINCE_CODE, conditions: guidCondition(guid), pageNum: 1, pageSize: 2 };
  return http.get('/api/query/attr/page', { schema: featurePageSchema, envelope: false, silent: true, query, signal });
}

/** 要素的详情：属性和完整几何 */
export interface FeatureDetail {
  readonly properties: FeatureRecord;
  readonly geometry: Geometry;
}

/** 并行查属性和完整几何；不是恰好一条时抛错（ADR 0047 第 3 节） */
export async function fetchFeatureDetail(
  layerCode: string,
  guid: string,
  signal?: AbortSignal
): Promise<FeatureDetail> {
  const [attributes, geometries] = await Promise.all([
    queryFeatureAttributes(layerCode, guid, signal),
    queryFeatureGeometries(layerCode, guid, signal)
  ]);
  const [properties] = attributes.list;
  const [shape] = geometries;
  if (attributes.list.length === 0 || geometries.length === 0) {
    throw new Error('没有找到这个要素的完整信息');
  }
  if (attributes.list.length > 1 || geometries.length > 1 || !properties || !shape) {
    throw new Error('主键对应多条记录，无法确定要素');
  }
  return { properties, geometry: shape.geom };
}
