import type { ViewBounds } from '@yzt/map-core';
import { z } from 'zod';
import { fetchFile } from '@/shared/file-transfer';
import { http } from '@/shared/http/client';
import { geometryTextSchema } from '@/shared/map/geometry-schema';

// 查询接口成功时没有信封，失败时返回信封（ADR 0047 第 8 节）；结构按 2026-10-28 实测确定（docs/migration.md）

/** 结果表的一行：字段按图层不同，由列配置按需读取 */
const recordSchema = z.record(z.string(), z.unknown());

export type ResultRecord = z.infer<typeof recordSchema>;

// 分页插件（PageHelper）的返回，还有 startRow、navigatepageNums 等字段，用不到
const pageSchema = z.object({ total: z.number(), pageNum: z.number(), pages: z.number(), list: z.array(recordSchema) });

export type ResultPage = z.infer<typeof pageSchema>;

/** 空间查询命中的要素：只有主键和几何 */
const featuresSchema = z.array(z.object({ guid: z.string(), geom: geometryTextSchema }));

export type ResultFeatures = z.infer<typeof featuresSchema>;

/** 一次查询：属性类（属性、自然语言、高级）按行政区划和条件，空间类按画的范围或上传的 shp */
export type QueryRequest =
  | {
      readonly kind: 'attribute';
      /** 从哪个页签发起：切页签时决定是否保留结果，高级查询不能导出 */
      readonly origin: 'attribute' | 'natural' | 'advanced';
      readonly layerCode: string;
      readonly xzqdm: string;
      readonly conditions: string;
    }
  | {
      readonly kind: 'geometry';
      readonly layerCode: string;
      /** GeoJSON 几何的字符串 */
      readonly geometry: string;
      /** 几何的外包框，定位用 */
      readonly bounds: ViewBounds;
    }
  | {
      readonly kind: 'shp';
      readonly layerCode: string;
      /** 每选一次文件加 1；查询缓存按它区分不同的文件（File 序列化后都是空对象） */
      readonly fileId: number;
      readonly file: File;
    };

export interface PageParams {
  readonly pageNum: number;
  readonly pageSize: number;
}

// shp 查询：文件放在正文里，其余参数放在地址里（同旧页面）
function shpForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

/** 结果表的一页；失败由结果面板显示并重试，不弹全局提示 */
export function fetchResultPage(request: QueryRequest, { pageNum, pageSize }: PageParams, signal?: AbortSignal) {
  const options = { schema: pageSchema, envelope: false, silent: true, signal } as const;
  if (request.kind === 'attribute') {
    const { layerCode, xzqdm, conditions } = request;
    return http.get('/api/query/attr/page', { ...options, query: { layerCode, xzqdm, conditions, pageNum, pageSize } });
  }
  if (request.kind === 'geometry') {
    const { layerCode, geometry } = request;
    return http.get('/api/query/scope/geojson/page', { ...options, query: { layerCode, geometry, pageNum, pageSize } });
  }
  const query = { layerCode: request.layerCode, pageNum, pageSize };
  return http.post('/api/query/scope/shp/page', shpForm(request.file), { ...options, query });
}

/** 空间查询命中的全部要素，画在地图上；属性类的结果在地图上用 MVT，不用这个接口 */
export function fetchResultFeatures(
  request: Extract<QueryRequest, { kind: 'geometry' | 'shp' }>,
  signal?: AbortSignal
) {
  const options = { schema: featuresSchema, envelope: false, signal } as const;
  if (request.kind === 'geometry') {
    const { layerCode, geometry } = request;
    return http.get('/api/query/scope/geojson', { ...options, query: { layerCode, geometry } });
  }
  const query = { layerCode: request.layerCode };
  return http.post('/api/query/scope/shp', shpForm(request.file), { ...options, query });
}

/** 导出格式，直接对应接口的 format；多选时用逗号连接，后端打包成一个 zip */
export type ExportFormat = 'excel' | 'shp' | 'gdb';

/** 导出的文件名（后端没有给出时用）：沿用旧页面的规则 */
export function exportFileName(baseName: string, formats: readonly ExportFormat[]): string {
  const [only] = formats;
  if (formats.length > 1 || only === undefined) {
    return `${baseName}.zip`;
  }
  return only === 'excel' ? `${baseName}.xlsx` : `${baseName}_${only}.zip`;
}

/** 导出最后一次成功的查询；高级查询不能导出（同旧页面），由调用方先排除 */
export function exportResult(
  request: QueryRequest,
  formats: readonly ExportFormat[],
  baseName: string,
  signal?: AbortSignal
) {
  const format = formats.join(',');
  const fallbackName = exportFileName(baseName, formats);
  const options = { fallbackName, method: 'post', signal } as const;
  if (request.kind === 'attribute') {
    const { layerCode, xzqdm, conditions } = request;
    const body = { layerCode, xzqdm, relation: '', conditions, format, fileName: baseName };
    return fetchFile('/api/export/region', { ...options, body });
  }
  if (request.kind === 'geometry') {
    const { layerCode, geometry } = request;
    const body = { layerCode, geometry, relation: 'INTERSECTS', conditions: '', format, fileName: baseName };
    return fetchFile('/api/export/geojson', { ...options, body });
  }
  // shp 的导出要把上传的文件再传一次（同旧页面）
  const body = shpForm(request.file);
  body.append('layerCode', request.layerCode);
  body.append('relation', 'INTERSECTS');
  body.append('format', format);
  body.append('fileName', baseName);
  return fetchFile('/api/export/shp', { ...options, body });
}
