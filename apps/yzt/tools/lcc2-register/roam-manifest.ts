// 出生点、路线换成清单的写法（ADR 0156 第 4 节，docs/config/3dt-manifest.md）
import type { RouteSpan } from './args.ts';
import type { FloorGrid } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';
import { type Correction, meshToLngLatHeight, type Placement, yawToManifestHeading } from './placement.ts';
import type { GridProjection } from './projection.ts';
import { EYE_HEIGHT, type RoamPoint, routeOf, spawnOf, type TrackSample } from './roam.ts';

/** 换算要用的：投影、索引的 offset、修正、高程基准的差、算出的摆放 */
export interface RoamFrame {
  readonly projection: GridProjection;
  readonly offset: Vec3;
  readonly correction: Correction;
  readonly datum: number;
  readonly placement: Placement;
}

/** 清单里的出生点 */
export interface ManifestSpawn {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly heading: number;
}

/** 清单里的路线：点是脚下地板的 [经度, 纬度, 椭球高]，矮的地方多一个眼高 */
export interface ManifestRoute {
  readonly id: string;
  readonly name: string;
  readonly path: readonly (readonly number[])[];
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

function lngLatHeight(frame: RoamFrame, { x, y, floor }: RoamPoint): Vec3 {
  return meshToLngLatHeight(frame.projection, frame.offset, frame.correction, frame.datum, [x, y, floor]);
}

/** 出生点：经纬度 7 位小数（约 1 厘米），高度到厘米，朝向到 0.1 度 */
export function manifestSpawn(track: readonly TrackSample[], from: number, frame: RoamFrame): ManifestSpawn {
  const { point, yaw } = spawnOf(track, from);
  const [lng, lat, height] = lngLatHeight(frame, point);
  return {
    lng: round(lng, 7),
    lat: round(lat, 7),
    height: round(height, 2),
    heading: round(yawToManifestHeading(yaw, frame.placement.heading), 1)
  };
}

/** 一条路线：眼高到厘米，等于 EYE_HEIGHT 的不写；grid 是 trackOf 用的那份 */
export function manifestRoute(
  track: readonly TrackSample[],
  span: RouteSpan,
  frame: RoamFrame,
  grid: FloorGrid
): ManifestRoute {
  const path = routeOf(track, span.from, span.to, grid).map(point => {
    const [lng, lat, height] = lngLatHeight(frame, point);
    const eye = round(point.eye, 2);
    return eye < EYE_HEIGHT
      ? [round(lng, 7), round(lat, 7), round(height, 2), eye]
      : [round(lng, 7), round(lat, 7), round(height, 2)];
  });
  return { id: span.id, name: span.name, path };
}

/** 轨迹的概要：每 step 米一行，挑路线段用 */
export function outline(track: readonly TrackSample[], step = 20): string[] {
  const lines: string[] = [];
  let next = 0;
  for (const { point, distance, floor, ceiling } of track) {
    if (distance < next) {
      continue;
    }
    next += step;
    const [x, y, z] = point;
    const ground = floor === undefined ? '脚下没有网格' : `地板 ${floor.toFixed(2)}，扫描仪离地 ${(z - floor).toFixed(2)}`;
    const room = floor === undefined || ceiling === undefined ? '' : `，净空 ${(ceiling - floor).toFixed(2)}`;
    lines.push(`${distance.toFixed(0).padStart(6)} 米：局部 (${x.toFixed(1)}, ${y.toFixed(1)})，${ground}${room}`);
  }
  return lines;
}
