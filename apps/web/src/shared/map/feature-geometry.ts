import { z } from 'zod';
import { http } from '../http/client';
import { geometryTextSchema } from './geometry-schema';

const featureGeometriesSchema = z.array(z.object({ guid: z.string(), geom: geometryTextSchema }));
const GUID_PATTERN = /^[0-9a-f]{32}$/;
// 完整几何不能被当前查询范围裁断
const WORLD = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85]
    ]
  ]
});

/** 查询和瓦片共用的要素主键契约 */
export function isFeatureGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID_PATTERN.test(value);
}

/** 主键先校验再拼接，非法输入不请求接口 */
export function guidCondition(guid: string): string {
  if (!GUID_PATTERN.test(guid)) {
    throw new Error(`要素主键格式不对：${guid}`);
  }
  return `"guid" = '${guid}'`;
}

/** 现状底图和数据查询共用的完整几何读取 */
export function queryFeatureGeometries(layerCode: string, guid: string, signal?: AbortSignal) {
  const query = { layerCode, geometry: WORLD, relation: 'INTERSECTS', conditions: guidCondition(guid) };
  return http.get('/api/query/scope/geojson', {
    schema: featureGeometriesSchema,
    envelope: false,
    silent: true,
    query,
    signal
  });
}
