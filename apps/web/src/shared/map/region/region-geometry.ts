import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import type { LngLat, ViewBounds } from '@yzt/map-core';
import { z } from 'zod';
import cityUrl from '../boundary/data/jiangsu-city.json?url';
import countyUrl from '../boundary/data/jiangsu-county.json?url';
import type { Region } from './region-catalog';

/** 一个多边形：外环在前，后面是洞 */
type PolygonRings = Position[][];

/** 选中区划的边界（ADR 0036）：多个要素合并成一个几何，范围用于定位 */
export interface RegionBoundary {
  readonly code: string;
  readonly geometry: Polygon | MultiPolygon;
  readonly bounds: ViewBounds;
}

/** 读取边界文件的 JSON；默认用 fetch，测试时注入 */
export type LoadJson = (url: string) => Promise<unknown>;

export interface RegionBoundaryLoader {
  /** 取出区划的边界；同一个文件只下载、解析一次，失败时下次重新下载 */
  load(region: Region): Promise<RegionBoundary>;
  /** 点所在区县的代码，不在任何区县里（省外）时为 null；县界简化过，边界附近可能判错（ADR 0037） */
  districtCodeAt(lngLat: LngLat): Promise<string | null>;
}

// 一个区划的多边形和外包范围；外包范围也用来在判断点在哪个区县时先排除
interface IndexEntry {
  readonly polygons: PolygonRings[];
  readonly bounds: ViewBounds;
}

// 坐标由边界的转换脚本生成并检查过（tools/boundaries），这里只确认是数组：逐个检查 1.4 MB 的市界约要 40 ms
const coordinates = <T>() => z.custom<T>(value => Array.isArray(value));

const boundaryFileSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({ code: z.string() }),
      geometry: z.discriminatedUnion('type', [
        z.object({ type: z.literal('Polygon'), coordinates: coordinates<PolygonRings>() }),
        z.object({ type: z.literal('MultiPolygon'), coordinates: coordinates<PolygonRings[]>() })
      ])
    })
  )
});

/** 边界数据里的代码换成 6 位：市界是 12 位，县界是 156 加 6 位 */
export function boundaryCode(code: string): string {
  return (code.length === 9 && code.startsWith('156') ? code.slice(3) : code).slice(0, 6);
}

/** 多边形的外包范围；洞在外环里面，只看外环 */
export function polygonBounds(polygons: readonly PolygonRings[]): ViewBounds {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [outer = []] of polygons) {
    for (const [lng, lat] of outer) {
      west = Math.min(west, lng);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      north = Math.max(north, lat);
    }
  }
  return [west, south, east, north];
}

function indexByCode(json: unknown): Map<string, IndexEntry> {
  const grouped = new Map<string, PolygonRings[]>();
  for (const { properties, geometry } of boundaryFileSchema.parse(json).features) {
    const code = boundaryCode(properties.code);
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    grouped.set(code, [...(grouped.get(code) ?? []), ...polygons]);
  }
  return new Map([...grouped].map(([code, polygons]) => [code, { polygons, bounds: polygonBounds(polygons) }]));
}

function contains([west, south, east, north]: ViewBounds, [lng, lat]: LngLat): boolean {
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`边界数据下载失败：${response.status} ${url}`);
  }
  return response.json();
}

/**
 * 从 5B.2 的市界、县界文件取区划的边界（同一个地址，命中 HTTP 缓存）。
 * 下载由各次加载共用，不随某一次选择取消；过期的结果由调用方丢弃
 */
export function createRegionBoundaryLoader(loadJson: LoadJson = fetchJson): RegionBoundaryLoader {
  const files = new Map<string, Promise<Map<string, IndexEntry>>>();

  const indexOf = (url: string) => {
    let pending = files.get(url);
    if (!pending) {
      pending = loadJson(url)
        .then(indexByCode)
        .catch((error: unknown) => {
          files.delete(url);
          throw error;
        });
      files.set(url, pending);
    }
    return pending;
  };

  return {
    async load(region) {
      const index = await indexOf(region.level === 'city' ? cityUrl : countyUrl);
      const entry = index.get(region.code);
      if (!entry) {
        throw new Error(`边界数据里没有${region.name}（${region.code}）`);
      }
      const { polygons, bounds } = entry;
      // 连云港的市界是两个要素，合并成一个几何
      const geometry: Polygon | MultiPolygon =
        polygons.length === 1
          ? { type: 'Polygon', coordinates: polygons[0] }
          : { type: 'MultiPolygon', coordinates: polygons };
      return { code: region.code, geometry, bounds };
    },

    async districtCodeAt(lngLat) {
      const index = await indexOf(countyUrl);
      for (const [code, { polygons, bounds }] of index) {
        const inside =
          contains(bounds, lngLat) &&
          polygons.some(rings => booleanPointInPolygon([...lngLat], { type: 'Polygon', coordinates: rings }));
        if (inside) {
          return code;
        }
      }
      return null;
    }
  };
}
