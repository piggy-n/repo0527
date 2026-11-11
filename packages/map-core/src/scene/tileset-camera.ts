import { distanceToZoom, MAPLIBRE_FOVY } from '../camera/camera-distance';
import type { CameraState } from '../camera/camera-model';
import type { LngLat } from '../view/view-input';

/** 定位到瓦片集时的俯角（度）：和旧项目的 flyToBoundingSphere 一样斜着看 */
export const TILESET_PITCH = 55;

const PITCH_RADIANS = (TILESET_PITCH * Math.PI) / 180;

// 纬度一度的地面米数：只用来挪视线的落点，比江苏的实际值大约 0.4%，球心高 84 米时差约 0.4 米
const METERS_PER_DEGREE_LATITUDE = 111320;

/** 瓦片集的包围球：球心的经纬度、真实椭球高和半径（米） */
export interface TilesetSphere {
  readonly center: LngLat;
  readonly height: number;
  readonly radius: number;
}

/**
 * 让整个包围球进入画布的相机（ADR 0081 第 2 节）：竖直方向放下球的直径，两种三维引擎共用。
 * 相机状态描述的是视线和地面的交点，所以球心在空中时交点要沿视线往前挪，球心才在画面中央
 */
export function tilesetCamera({ center, height, radius }: TilesetSphere, viewportHeight: number): CameraState {
  const [lng, lat] = center;
  const latitude = lat + (height * Math.tan(PITCH_RADIANS)) / METERS_PER_DEGREE_LATITUDE;
  const distance = Math.max(1, radius / Math.sin(MAPLIBRE_FOVY / 2) + height / Math.cos(PITCH_RADIANS));
  return {
    center: [lng, latitude],
    zoom: distanceToZoom(distance, latitude, Math.max(1, viewportHeight), MAPLIBRE_FOVY),
    bearing: 0,
    pitch: TILESET_PITCH
  };
}
