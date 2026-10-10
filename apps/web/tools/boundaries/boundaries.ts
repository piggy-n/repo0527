import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { z } from 'zod';

/** 输出的边界：每个要素只有名称和代码 */
export type Boundary = FeatureCollection<Polygon | MultiPolygon, { name: string; code: string }>;

export interface BoundarySource {
  /** 旧项目 public/static/geojson 下的文件名 */
  readonly input: string;
  /** shared/map/boundary/data 下的文件名 */
  readonly output: string;
  readonly convert: (data: unknown) => Boundary;
}

const position = z.array(z.number()).min(2);
const polygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position)) });
const multiPolygon = z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(position))) });

// 6 位小数约 0.1 米，远小于屏幕上能分辨的距离
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const roundRing = (ring: Position[]): Position[] => ring.map(([lng, lat]) => [round(lng), round(lat)]);

/**
 * 一级边界的转换：坐标保留 6 位小数，属性只留名称和代码；crs 等其他成员去掉（GeoJSON 规定为 WGS 84，CGCS2000 与它相差不到 1 米）。
 * 原始文件的结构不符合时直接报错
 */
function boundarySource<P>(
  input: string,
  output: string,
  properties: z.ZodType<P>,
  pick: (properties: P) => { name: string; code: string }
): BoundarySource {
  const schema = z.object({
    type: z.literal('FeatureCollection'),
    features: z
      .array(z.object({ type: z.literal('Feature'), properties, geometry: z.union([polygon, multiPolygon]) }))
      .min(1)
  });
  return {
    input,
    output,
    convert: data => ({
      type: 'FeatureCollection',
      features: schema.parse(data).features.map(feature => ({
        type: 'Feature',
        properties: pick(feature.properties),
        geometry:
          feature.geometry.type === 'Polygon'
            ? { type: 'Polygon', coordinates: feature.geometry.coordinates.map(roundRing) }
            : { type: 'MultiPolygon', coordinates: feature.geometry.coordinates.map(rings => rings.map(roundRing)) }
      }))
    })
  };
}

/** 三级边界，来源是 yzt 836f03b 的 public/static/geojson（ADR 0033） */
export const BOUNDARY_SOURCES: readonly BoundarySource[] = [
  boundarySource('江苏省界.json', 'jiangsu-province.json', z.object({ Name: z.string(), adcode: z.string() }), p => ({
    name: p.Name,
    code: p.adcode
  })),
  boundarySource('江苏省市界.json', 'jiangsu-city.json', z.object({ Name: z.string(), code: z.string() }), p => ({
    name: p.Name,
    code: p.code
  })),
  boundarySource('江苏省县界.json', 'jiangsu-county.json', z.object({ name: z.string(), gb: z.string() }), p => ({
    name: p.name,
    code: p.gb
  }))
];
