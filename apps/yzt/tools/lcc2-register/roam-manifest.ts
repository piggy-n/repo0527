// 出生点、路线换成清单的写法（ADR 0156 第 4 节，docs/config/3dt-manifest.md）
import type { RouteSpan } from './args.ts';
import type { FloorGrid } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';
import { type Correction, meshToLngLatHeight, type Placement, yawToManifestHeading } from './placement.ts';
import type { GridProjection } from './projection.ts';
import { EYE_HEIGHT, type RoamPoint, routeOf, spawnOf, type Stretch, type TrackSample } from './roam.ts';

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

/** 写进清单的眼高：到厘米，取整以后等于 EYE_HEIGHT 的不写（undefined）；平面图上"眼高低于 1.6 的点"按同一个判断 */
export function manifestEye(eye: number): number | undefined {
  const rounded = round(eye, 2);
  return rounded < EYE_HEIGHT ? rounded : undefined;
}

/** 路线的点（局部系）换成清单的写法：矮的地方多一个眼高（manifestEye） */
export function manifestPath(points: readonly RoamPoint[], frame: RoamFrame): ManifestRoute['path'] {
  return points.map(point => {
    const [lng, lat, height] = lngLatHeight(frame, point);
    const spot = [round(lng, 7), round(lat, 7), round(height, 2)];
    const eye = manifestEye(point.eye);
    return eye === undefined ? spot : [...spot, eye];
  });
}

/** 清单里的一条补的地板（ADR 0170）：宽度和沿线的点 [经度, 纬度, 地板的椭球高] */
export interface ManifestWalkway {
  readonly width: number;
  readonly path: readonly (readonly number[])[];
}

/** 补的地板（局部系）换成清单的写法：点的经纬度、高度的位数同路线，不带眼高；宽度到厘米 */
export function manifestWalkway(points: readonly RoamPoint[], width: number, frame: RoamFrame): ManifestWalkway {
  const path = points.map(point => {
    const [lng, lat, height] = lngLatHeight(frame, point);
    return [round(lng, 7), round(lat, 7), round(height, 2)];
  });
  return { width: round(width, 2), path };
}

/** 一条路线；grid 是 trackOf 用的那份，stretches 是按轨迹米数分段的拉直容差 */
export function manifestRoute(
  track: readonly TrackSample[],
  span: RouteSpan,
  frame: RoamFrame,
  grid: FloorGrid,
  stretches: readonly Stretch[] = []
): ManifestRoute {
  const points = routeOf(track, span.from, span.to, grid, { tolerance: span.tolerance, stretches });
  return { id: span.id, name: span.name, path: manifestPath(points, frame) };
}

/** 概要取的取样点：每 step 米第一个；平面图的米数标在同一批点上 */
export function outlineSamples(track: readonly TrackSample[], step = 20): TrackSample[] {
  const samples: TrackSample[] = [];
  let next = 0;
  for (const sample of track) {
    if (sample.distance >= next) {
      next += step;
      samples.push(sample);
    }
  }
  return samples;
}

/** 概要的一行：米数、局部坐标、地板、扫描仪离地、净空 */
export function outlineLine({ point: [x, y, z], distance, floor, ceiling }: TrackSample): string {
  const ground = floor === undefined ? '脚下没有网格' : `地板 ${floor.toFixed(2)}，扫描仪离地 ${(z - floor).toFixed(2)}`;
  const room = floor === undefined || ceiling === undefined ? '' : `，净空 ${(ceiling - floor).toFixed(2)}`;
  return `${distance.toFixed(0).padStart(6)} 米：局部 (${x.toFixed(1)}, ${y.toFixed(1)})，${ground}${room}`;
}

/** 轨迹的概要：每 step 米一行，挑路线段用 */
export function outline(track: readonly TrackSample[], step = 20): string[] {
  return outlineSamples(track, step).map(outlineLine);
}
