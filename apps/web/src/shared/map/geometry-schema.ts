import { z } from 'zod';

const position = z.array(z.number()).min(2);

/** 查询接口的 GeoJSON 几何，先校验坐标再交给地图 */
export const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position) }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position)) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position)) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(position))) })
]);

/** 后端 geom 字段是 JSON 字符串；解析失败由 HTTP 层报告契约错误 */
export const geometryTextSchema = z.string().transform((text, context) => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    context.addIssue({ code: 'custom', message: '几何不是合法的 JSON' });
    return z.NEVER;
  }
}).pipe(geometrySchema);
