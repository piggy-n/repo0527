// 只供测试：用真实的县界和正式的覆盖分析建自定义范围
import type { MultiPolygon, Position } from 'geojson';
import { coverRegions } from '@/shared/map/area/area-coverage';
import type { DistrictAtlas } from './districts';
import { createScopeArea, type ScopeArea } from './scope';

/** 经纬度的矩形 */
export const box = (west: number, south: number, east: number, north: number): Position[] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south]
];

/** 每个环一个面的 GeoJSON 文件，交给上传 */
export const geojsonFile = (name: string, rings: readonly Position[][]): File =>
  new File(
    [
      JSON.stringify({
        type: 'FeatureCollection',
        features: rings.map(ring => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [ring] }
        }))
      })
    ],
    name
  );

/** 一个或几个矩形组成的自定义范围，覆盖按 95 个区县分析 */
export async function testArea(atlas: DistrictAtlas, rings: readonly Position[][], name = '测试范围'): Promise<ScopeArea> {
  const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: rings.map(ring => [ring]) };
  const regions = atlas.all.map(district => ({ code: district.code, geometry: district.geometry }));
  const outcome = await coverRegions(geometry, regions, { scopeName: '江苏省' });
  if (!outcome.ok) {
    throw new Error(`测试范围不能使用：${outcome.problem.message}`);
  }
  const { coverage } = outcome;
  return createScopeArea(atlas, { name, source: 'draw', file: null, geometry, outline: geometry, coverage });
}

/** 南京主城附近：秦淮区全部覆盖，周围几个区部分覆盖 */
export const NANJING_RINGS: readonly Position[][] = [box(118.74, 31.95, 118.93, 32.09)];

/** 跨南京、镇江两个市 */
export const NINGZHEN_RINGS: readonly Position[][] = [box(118.95, 32.02, 119.25, 32.16)];
