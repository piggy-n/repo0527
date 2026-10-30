import { z } from 'zod';

const position = z.array(z.number()).min(2);

/** GeoJSON 几何：后端返回的几何要拿来算范围、高亮，逐层校验坐标 */
export const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position) }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position)) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position)) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(position))) })
]);

/** 查询接口的 geom 字段：GeoJSON 几何的字符串 */
export const geometryTextSchema = z
  .string()
  .transform((text, context) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: '几何不是合法的 JSON' });
      return z.NEVER;
    }
  })
  .pipe(geometrySchema);
