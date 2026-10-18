import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  EllipsoidTerrainProvider,
  IntersectionTests,
  Math as CesiumMath,
  Ray,
  SceneTransforms,
  type Scene
} from 'cesium';
import type { LngLat, PickResult, ScreenPoint } from '@yzt/map-core';

/** 三维按模型深度、地形、椭球拾取；命中模型但没有深度时不悄悄改用地表 */
export function pickScene(scene: Scene, point: ScreenPoint): PickResult {
  const pixel = new Cartesian2(point.x, point.y);
  if (scene.pick(pixel) !== undefined) {
    const position = scene.pickPositionSupported ? scene.pickPosition(pixel) : undefined;
    return position ? hit(position, scene, 'model') : { kind: 'miss' };
  }
  const ray = scene.camera.getPickRay(pixel);
  if (!ray) {
    return { kind: 'miss' };
  }
  const position = scene.globe.pick(ray, scene);
  if (!position) {
    return { kind: 'miss' };
  }
  return hit(position, scene, scene.terrainProvider instanceof EllipsoidTerrainProvider ? 'ellipsoid' : 'terrain');
}

// 表面类型由命中的路径决定，高度统一为椭球高
function hit(position: Cartesian3, scene: Scene, surface: 'model' | 'terrain' | 'ellipsoid'): PickResult {
  const location = Cartographic.fromCartesian(position, scene.ellipsoid);
  return {
    kind: 'hit', surface,
    lngLat: [CesiumMath.toDegrees(location.longitude), CesiumMath.toDegrees(location.latitude)],
    height: location.height
  };
}

/** 排除相机背后和被椭球遮挡的点；返回 CSS 像素，允许画布范围之外的投影 */
export function projectScene(scene: Scene, [lng, lat]: LngLat, height = 0): ScreenPoint | null {
  const target = Cartesian3.fromDegrees(lng, lat, height, scene.ellipsoid);
  const offset = Cartesian3.subtract(target, scene.camera.positionWC, new Cartesian3());
  const distance = Cartesian3.magnitude(offset);
  if (distance === 0 || Cartesian3.dot(offset, scene.camera.directionWC) <= 0) {
    return null;
  }
  const ray = new Ray(scene.camera.positionWC, Cartesian3.normalize(offset, new Cartesian3()));
  const intersection = IntersectionTests.rayEllipsoid(ray, scene.ellipsoid);
  // 地表终点本身的相交不是遮挡；厘米容差只吸收椭球运算误差
  if (intersection && intersection.start > 0 && intersection.start < distance - 0.01) {
    return null;
  }
  const pixel = SceneTransforms.worldToWindowCoordinates(scene, target);
  return pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y) ? { x: pixel.x, y: pixel.y } : null;
}
