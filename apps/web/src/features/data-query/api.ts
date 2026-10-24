import { z } from 'zod';
import { fetchFile, type TransferProgress } from '@/shared/file-transfer';
import { http } from '@/shared/http/client';
import { geometryTextSchema } from '@/shared/map/geometry-schema';
import type { QuerySnapshot } from './types';
import { PAGE_SIZE } from './config';

const recordSchema = z.record(z.string(), z.unknown());
// 与现状底图相同的查询契约，成功响应没有 code/data 信封（ADR 0047）
const pageSchema = z.object({ total: z.number().int().nonnegative(), list: z.array(recordSchema) });
const shapesSchema = z.array(z.object({ geom: geometryTextSchema }));
export type QueryRecord = z.infer<typeof recordSchema>;
export type QueryPage = z.infer<typeof pageSchema>;

/** JSON 和文件请求共用同一份快照参数 */
export function requestParameters(snapshot: QuerySnapshot) {
  return {
    layerCode: snapshot.layer.code,
    conditions: snapshot.conditions,
    relation: 'INTERSECTS',
    ...(snapshot.scope.kind === 'region' ? { xzqdm: snapshot.scope.code } : {}),
    ...(snapshot.scope.kind === 'geometry' ? { geometry: JSON.stringify(snapshot.scope.geometry) } : {})
  };
}

function shpBody(snapshot: QuerySnapshot, extra: Record<string, string | number> = {}): FormData {
  if (snapshot.scope.kind !== 'shp') {
    throw new Error('查询范围不是 SHP 文件');
  }
  const form = new FormData();
  form.append('file', snapshot.scope.file);
  for (const [key, value] of Object.entries({ ...requestParameters(snapshot), ...extra })) {
    form.append(key, value);
  }
  return form;
}

/** 属性与空间查询的分页；只使用已提交快照 */
export function fetchQueryPage(snapshot: QuerySnapshot, page: number, signal: AbortSignal) {
  const pagination = { pageNum: page, pageSize: PAGE_SIZE };
  const options = { schema: pageSchema, envelope: false, silent: true, signal };
  if (snapshot.scope.kind === 'shp') {
    return http.post('/api/query/scope/shp/page', shpBody(snapshot, pagination), options);
  }
  const path = snapshot.scope.kind === 'region' ? '/api/query/attr/page' : '/api/query/scope/geojson/page';
  return http.get(path, { ...options, query: { ...requestParameters(snapshot), ...pagination } });
}

/** 空间查询的完整范围结果用于地图，分页属性单独读取 */
export function fetchQueryShapes(snapshot: QuerySnapshot, signal: AbortSignal) {
  const options = { schema: shapesSchema, envelope: false, silent: true, signal };
  if (snapshot.scope.kind === 'shp') {
    return http.post('/api/query/scope/shp', shpBody(snapshot), options);
  }
  return http.get('/api/query/scope/geojson', { ...options, query: requestParameters(snapshot) });
}

export interface QueryDownload {
  id: string;
  name: string;
  snapshot: QuerySnapshot;
  formats: readonly string[];
}

/** 导出是按快照取文件，可取消；任务和错误状态交给公共下载组件 */
export function downloadQuery(target: QueryDownload, signal: AbortSignal, onProgress: (p: TransferProgress) => void) {
  const { snapshot, formats, name } = target;
  const extra = { format: formats.join(','), fileName: name };
  const scope = snapshot.scope.kind;
  const endpoint = scope === 'region' ? 'region' : scope === 'geometry' ? 'geojson' : 'shp';
  const body = scope === 'shp' ? shpBody(snapshot, extra) : { ...requestParameters(snapshot), ...extra };
  const extension = formats.length === 1 && formats[0] === 'excel' ? 'xlsx' : 'zip';
  return fetchFile(`/api/export/${endpoint}`, {
    method: 'post', body, signal, silent: true, onDownloadProgress: onProgress, fallbackName: `${name}.${extension}`
  });
}
