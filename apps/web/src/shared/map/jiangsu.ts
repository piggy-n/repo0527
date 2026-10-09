import type { CameraState, ViewBounds } from '@yzt/map-core';

/** 江苏省的范围，进入地图页、回到默认视角时按它定位 */
export const JIANGSU_BOUNDS: ViewBounds = [116.3, 30.7, 121.9, 35.2];

/** 创建地图时的相机，沿用旧项目的默认视角；进入页面后再按江苏的范围定位 */
export const JIANGSU_CAMERA: CameraState = { center: [119.5, 33.0], zoom: 6.8, bearing: 0, pitch: 0 };
