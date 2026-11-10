import type { Vec3 } from './lcc2-data.ts';
import type { GridProjection } from './projection.ts';

/** 清单里 `splat` 模型的摆放，口径见 docs/config/3dt-manifest.md */
export interface Placement {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly heading: number;
}

/** 泼溅和网格的修正：先绕局部系原点逆时针转 yaw（度），再平移 shift（米，网格的东、北、上） */
export interface Correction {
  readonly shift: Vec3;
  readonly yaw: number;
}

export const NO_CORRECTION: Correction = { shift: [0, 0, 0], yaw: 0 };

const DEGREE = Math.PI / 180;

/**
 * 修正后的摆放：局部系原点放在 offset + shift（网格坐标），朝向是网格东向的方位加上 yaw；
 * datum 是高程基准的差，只加在高度上，泼溅、网格和轨迹一起抬
 */
export function placementFor(projection: GridProjection, offset: Vec3, correction: Correction, datum = 0): Placement {
  const east = offset[0] + correction.shift[0];
  const north = offset[1] + correction.shift[1];
  const [lng, lat] = projection.toLngLat(east, north);
  return {
    lng,
    lat,
    height: offset[2] + correction.shift[2] + datum,
    heading: projection.gridEastHeading(east, north) + correction.yaw
  };
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** 写进清单的精度：经纬度 7 位小数（约 1 厘米），高度到厘米，朝向到千分之一度 */
export function roundPlacement(placement: Placement): Placement {
  return {
    lng: round(placement.lng, 7),
    lat: round(placement.lat, 7),
    height: round(placement.height, 2),
    heading: round(placement.heading, 3)
  };
}

/**
 * 轨迹点换到泼溅和网格的局部系：轨迹按 offset 摆放是对的（ADR 0149 背景），网格按修正摆放，
 * 所以轨迹点要经过修正的逆变换，才能和网格比
 */
export function trajectoryToMesh(point: Vec3, correction: Correction): Vec3 {
  const x = point[0] - correction.shift[0];
  const y = point[1] - correction.shift[1];
  const cos = Math.cos(correction.yaw * DEGREE);
  const sin = Math.sin(correction.yaw * DEGREE);
  return [cos * x + sin * y, -sin * x + cos * y, point[2] - correction.shift[2]];
}

/** 拟合得到的平移（轨迹到网格）换成修正（网格到轨迹）：方向相反 */
export function correctionFromFit(fitShift: Vec3): Vec3 {
  return [-fitShift[0], -fitShift[1], -fitShift[2]];
}
