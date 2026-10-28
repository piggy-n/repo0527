import {
  EYE_HEIGHT,
  headingToYaw,
  levelOf,
  type NavFrame,
  type NavLevel,
  type Point3,
  type RoutePath,
  type RoutePoint,
  type WalkPlayer
} from '@yzt/map-core';
import { type IndoorMap, type MapPlayer, toPlane } from './indoor-map';

// 路线漫游时室内地图上的路线和人（ADR 0097 第 6 节）：路线换到导航网格的局部系，人按走过的米数从路线上取

/** 路线在导航网格局部系里的一点：位置、脚下地板的高度，从起点走到这里的米数 */
export interface TrackPoint {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly distance: number;
}

/** 室内地图上要画的路线：整条路线和走过的米数 */
export interface RouteTrack {
  readonly points: readonly TrackPoint[];
  readonly walked: number;
}

/** 正北朝上的平面里的一条折线（东、北，米） */
export type PlaneLine = readonly (readonly [east: number, north: number])[];

// 路线漫游的竖直视场角是 60°（map-cesium 的 scene-route），小地图的视野扇形按 16:9 的画布换成水平的
const ROUTE_HFOV = 2 * Math.atan(Math.tan(Math.PI / 6) * (16 / 9));

/** 路线的折线换到导航网格的局部系，带累计的米数（三维长度，楼梯的高差也算，同 RoutePath） */
export function trackPoints(frame: NavFrame, path: readonly RoutePoint[]): TrackPoint[] {
  let distance = 0;
  let previous: Point3 | null = null;
  return path.map(([lng, lat, floor]) => {
    const local = frame.toLocal(lng, lat, floor);
    if (previous) {
      const [px, py, pz] = previous;
      distance += Math.hypot(local[0] - px, local[1] - py, local[2] - pz);
    }
    previous = local;
    return { x: local[0], y: local[1], floor: local[2], distance };
  });
}

/** 路线漫游时地图上的人：走过 distance 米处的视点，朝向沿路线看前方；没有点击移动的落点 */
export function routePlayer(frame: NavFrame, path: RoutePath, distance: number): WalkPlayer {
  const pose = path.pose(distance);
  const [x, y, floor] = frame.toLocal(pose.lng, pose.lat, pose.height - EYE_HEIGHT);
  return { x, y, floor, yaw: headingToYaw(pose.heading, frame.north), hfov: ROUTE_HFOV, target: null };
}

// 按楼层切开：只留落在这一层上的连续的点，两个点以上才是一条线
function linesOn(map: IndoorMap, level: NavLevel, points: readonly Omit<TrackPoint, 'distance'>[]): PlaneLine[] {
  const lines: (readonly [number, number])[][] = [];
  let current: (readonly [number, number])[] = [];
  for (const point of points) {
    if (levelOf(map.levels, point.floor) === level) {
      current.push(toPlane(map, point.x, point.y));
    } else {
      lines.push(current);
      current = [];
    }
  }
  lines.push(current);
  return lines.filter(line => line.length > 1);
}

/**
 * 这一层上要画的路线：整条路线（all）和走过的一段（passed），都只有落在这一层上的部分；
 * 走过的一段到人所在的位置为止，没有人（看别的楼层、还没有位置）时到走过的米数为止
 */
export function trackOnLevel(
  map: IndoorMap,
  level: NavLevel,
  track: RouteTrack,
  player: MapPlayer | null
): { readonly all: PlaneLine[]; readonly passed: PlaneLine[] } {
  const passed = track.points.filter(point => point.distance <= track.walked);
  const end = player ? [{ x: player.x, y: player.y, floor: player.floor }] : [];
  return { all: linesOn(map, level, track.points), passed: linesOn(map, level, [...passed, ...end]) };
}
