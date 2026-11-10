import { distanceToZoom, MAPLIBRE_FOVY } from '../camera/camera-distance';
import type { CameraState } from '../camera/camera-model';
import type { LngLat } from '../view/view-input';

/** 定位到瓦片集时的俯角（度）：和旧项目的 flyToBoundingSphere 一样斜着看 */
export const TILESET_PITCH = 55;

/** 瓦片集的包围球：球心的经纬度和半径（米） */
export interface TilesetSphere {
  readonly center: LngLat;
  readonly radius: number;
}

/** 让整个包围球进入画布的相机（ADR 0081 第 2 节）：竖直方向放下球的直径，两种三维引擎共用 */
export function tilesetCamera({ center, radius }: TilesetSphere, viewportHeight: number): CameraState {
  const [, lat] = center;
  const distance = Math.max(1, radius / Math.sin(MAPLIBRE_FOVY / 2));
  return {
    center,
    zoom: distanceToZoom(distance, lat, Math.max(1, viewportHeight), MAPLIBRE_FOVY),
    bearing: 0,
    pitch: TILESET_PITCH
  };
}
