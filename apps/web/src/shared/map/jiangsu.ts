import type { CameraState, ViewBounds } from '@yzt/map-core';

/** 江苏省的范围（省界数据的实际范围向外取整，ADR 0033），进入地图页、回到默认视角时按它定位 */
export const JIANGSU_BOUNDS: ViewBounds = [116.35, 30.75, 121.98, 35.15];

/** 创建地图时的相机，沿用旧项目的默认视角；进入页面后再按江苏的范围定位 */
export const JIANGSU_CAMERA: CameraState = { center: [119.5, 33.0], zoom: 6.8, bearing: 0, pitch: 0 };

/** 地图的缩放范围，与旧项目一致：5 级能看到江苏和周边，天地图只到 18 级；由页面通过画布的 mapOptions 传入 */
export const JIANGSU_ZOOM_RANGE = { minZoom: 5, maxZoom: 18 } as const;
