import { distanceToZoom, MAPLIBRE_FOVY } from '../../camera/camera-distance';
import type { CameraState } from '../../camera/camera-model';
import { EYE_HEIGHT } from '../../scene/route-path';
import { fromEcef, type Point3, toEcef } from '../../scene/nav/nav-frame';

// 漫游的相机换算（ADR 0147 第 4 节）：漫游控制器给出真实的视点（地心坐标），这里换成 MapLibre 的相机；
// 抬高只在这一步加上，之外一律是真实的椭球高

/** 视点：地心坐标的位置和视线方向（单位向量），真实的高度 */
export interface RoamEye {
  readonly position: Point3;
  readonly direction: Point3;
}

/** 交给 MapLibre jumpTo 的相机：中心点带高度（漫游期间 centerClampedToGround 关掉） */
export interface ElevatedCamera {
  readonly center: [number, number];
  readonly elevation: number;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

/** 视点的经纬度、真实椭球高，朝向（度，正北为 0、顺时针）和俯仰（度，平视为 0、向上为正） */
export interface EyeAngles {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly heading: number;
  readonly pitch: number;
}

/** 漫游期间的缩放上限：PoC 里 28 时贴地相机算出 z26 的瓦片抛错，24 正常（坑 4） */
export const ROAM_MAX_ZOOM = 24;
// 第一人称的目标点放在视线前方这么远：近裁剪面随它变小（PoC：10 米时约 0.13 米）
const TARGET_DISTANCE = 10;
// 目标点近了缩放会超过上限：放远到缩放不超过这一级
const TARGET_MAX_ZOOM = 23.5;
// 抬高后视点的最低处要高出 0 米这么多
const LIFT_MARGIN = 2;
/** 退出时相机在模型里或地下：换到视点正上方这么高（同 Cesium 的 EXIT_HEIGHT） */
export const EXIT_HEIGHT = 120;
// 退出时的俯角上限：要看得到地面，会话的相机才有中心点
const EXIT_MAX_PITCH = 60;

// MapLibre 的地球半径和瓦片尺寸（墨卡托的口径，MercatorCoordinate、calculateCameraOptionsFromTo 用的）
const MAPLIBRE_EARTH_RADIUS = 6371008.8;
const TILE_SIZE = 512;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** 视点处的东、北、天三个方向（地心坐标的单位向量） */
export function enuAxes(lng: number, lat: number): { east: Point3; north: Point3; up: Point3 } {
  const lambda = toRadians(lng);
  const phi = toRadians(lat);
  return {
    east: [-Math.sin(lambda), Math.cos(lambda), 0],
    north: [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)],
    up: [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)]
  };
}

const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 由经纬度、真实椭球高和朝向、俯仰得到视点 */
export function eyeOf({ lng, lat, height, heading, pitch }: EyeAngles): RoamEye {
  const { east, north, up } = enuAxes(lng, lat);
  const h = toRadians(heading);
  const p = toRadians(pitch);
  const e = Math.sin(h) * Math.cos(p);
  const n = Math.cos(h) * Math.cos(p);
  const u = Math.sin(p);
  return {
    position: toEcef(lng, lat, height),
    direction: [0, 1, 2].map(i => e * east[i] + n * north[i] + u * up[i]) as Point3
  };
}

/** 视点的经纬度、椭球高、朝向和俯仰 */
export function anglesOf({ position, direction }: RoamEye): EyeAngles {
  const [lng, lat, height] = fromEcef(position);
  const { east, north, up } = enuAxes(lng, lat);
  const e = dot(direction, east);
  const n = dot(direction, north);
  const u = Math.max(-1, Math.min(1, dot(direction, up)));
  return {
    lng,
    lat,
    height,
    heading: (toDegrees(Math.atan2(e, n)) + 360) % 360,
    pitch: toDegrees(Math.asin(u))
  };
}

// 经纬度、高度换成 MapLibre 的墨卡托坐标（0～1；z 按 MapLibre 的地球半径换算高度）
function mercator(lng: number, lat: number, height: number): Point3 {
  const x = (180 + lng) / 360;
  const y = (180 - toDegrees(Math.log(Math.tan(Math.PI / 4 + toRadians(lat) / 2)))) / 360;
  const z = height / (2 * Math.PI * MAPLIBRE_EARTH_RADIUS * Math.cos(toRadians(lat)));
  return [x, y, z];
}

function lngLatOfMercator(x: number, y: number): [number, number] {
  const lng = x * 360 - 180;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(toRadians(180 - y * 360))) - 90;
  return [lng, lat];
}

// 相机到画布中心的距离（像素），MapLibre 的 cameraToCenterDistance
const cameraToCenter = (viewportHeight: number, fovy: number) => (0.5 / Math.tan(fovy / 2)) * viewportHeight;

/**
 * 第一人称的 MapLibre 相机：目标点放在视线前方（缩放不超过 23.5 级），视点和目标点都按真实位置换成墨卡托，
 * 再加上抬高量，按 MapLibre 墨卡托的 calculateCameraOptionsFromTo 解出中心、高度、缩放、方位和俯仰
 * （俯仰可以超过 90°）。不用 MapLibre 自己的：地球投影时它把目标当作在地面上（PoC 的坑 11）。fovy 是弧度
 */
export function firstPersonCamera(
  { position, direction }: RoamEye,
  { lift, viewportHeight, fovy }: { readonly lift: number; readonly viewportHeight: number; readonly fovy: number }
): ElevatedCamera {
  const [lng, lat, height] = fromEcef(position);
  const metersPerUnit = 2 * Math.PI * MAPLIBRE_EARTH_RADIUS * Math.cos(toRadians(lat));
  // 缩放 = log2(相机到中心的像素 / 距离的墨卡托单位 / 512)：缩放不超过上限时距离至少这么远
  const nearest = (cameraToCenter(viewportHeight, fovy) / TILE_SIZE / 2 ** TARGET_MAX_ZOOM) * metersPerUnit;
  const distance = Math.max(TARGET_DISTANCE, nearest);
  const target = fromEcef([0, 1, 2].map(i => position[i] + direction[i] * distance) as Point3);
  const from = mercator(lng, lat, height + lift);
  const to = mercator(target[0], target[1], target[2] + lift);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  const ground = Math.hypot(dx, dy);
  const tilt = toDegrees(Math.acos(Math.min(1, ground / length)));
  return {
    center: lngLatOfMercator(to[0], to[1]),
    elevation: target[2] + lift,
    zoom: Math.log2(cameraToCenter(viewportHeight, fovy) / length / TILE_SIZE),
    bearing: toDegrees(Math.atan2(dx, -dy)),
    pitch: dz < 0 ? 90 - tilt : 90 + tilt
  };
}

/**
 * 会话的相机（ADR 0147 第 4 节，真实的高度）：中心在 0 米面上。视点在 0 米以上、视线打得到 0 米面时，
 * 中心是交点；否则（在地下、平视或往上看）退化成视点正下方、俯角 0，同 Cesium 打不到地球时的做法
 */
export function groundCamera(eye: RoamEye, viewportHeight: number): CameraState {
  const { lng, lat, height, heading, pitch } = anglesOf(eye);
  // MapLibre 的俯角：0 是正俯视，90 是平视
  const tilt = 90 + pitch;
  if (height > 0 && tilt < 89) {
    const slant = height / Math.cos(toRadians(tilt));
    const across = height * Math.tan(toRadians(tilt));
    const target = fromEcef(eyeAt(lng, lat, heading, across));
    return {
      center: [target[0], target[1]],
      zoom: distanceToZoom(slant, lat, viewportHeight, MAPLIBRE_FOVY),
      bearing: heading,
      pitch: tilt
    };
  }
  return { center: [lng, lat], zoom: distanceToZoom(height, lat, viewportHeight, MAPLIBRE_FOVY), bearing: heading, pitch: 0 };
}

// 从 [lng, lat] 的地面沿朝向走 meters 米（切平面上，几百米以内误差可以忽略）的地心坐标
function eyeAt(lng: number, lat: number, heading: number, meters: number): Point3 {
  const { east, north } = enuAxes(lng, lat);
  const origin = toEcef(lng, lat, 0);
  const h = toRadians(heading);
  return [0, 1, 2].map(i => origin[i] + meters * (Math.sin(h) * east[i] + Math.cos(h) * north[i])) as Point3;
}

/**
 * 退出漫游时相机的去处（ADR 0147 第 4 节"退出时相机还在模型里的，先换到地表以上"）：
 * 视点正上方 EXIT_HEIGHT 米，朝向不变，俯角不超过 60°，缩放不超过 maxZoom
 */
export function exitCamera(eye: RoamEye, viewportHeight: number, maxZoom: number): CameraState {
  const { lng, lat, heading, pitch } = anglesOf(eye);
  const tilt = Math.max(0, Math.min(EXIT_MAX_PITCH, 90 + pitch));
  const camera = groundCamera(eyeOf({ lng, lat, height: EXIT_HEIGHT, heading, pitch: tilt - 90 }), viewportHeight);
  return { ...camera, zoom: Math.min(camera.zoom, maxZoom), pitch: Math.min(camera.pitch, EXIT_MAX_PITCH) };
}

/**
 * 抬高量（ADR 0147 第 4 节）：抬高后模型的最低处加上眼高要高出 0 米 LIFT_MARGIN，取整到米；不用抬高时为 0
 */
export function liftFor(lowestHeight: number): number {
  return Math.max(0, Math.ceil(LIFT_MARGIN - (lowestHeight + EYE_HEIGHT)));
}
