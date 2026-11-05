// 二三维相机的数值换算（ADR 0079 第 4 节），算法沿用旧 CesiumEngine：画布中心的地面比例与二维一致

/** MapLibre 6 的竖直视场角（弧度）：getVerticalFieldOfView() 的默认值 36.87° */
export const MAPLIBRE_FOVY = (36.86989764584402 * Math.PI) / 180;

// 赤道上 0 级、512 像素瓦片的每像素米数（MapLibre 的缩放级口径）
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.516964;

/** 正俯视时俯角抬高到这个值（度）：俯角正好为 0 时方位编码不进相机的姿态，读回时会丢掉 */
export const NADIR_EPSILON = 0.01;

function metersPerPixel(zoom: number, latitude: number): number {
  return (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

function assertViewport(viewportHeight: number, fovy: number): void {
  if (!(viewportHeight > 0) || !(fovy > 0 && fovy < Math.PI)) {
    throw new RangeError(`画布高度或视场角不合法：${viewportHeight}、${fovy}`);
  }
}

/** 缩放级换成相机到画布中心地面点的距离（米） */
export function zoomToDistance(zoom: number, latitude: number, viewportHeight: number, fovy: number): number {
  assertViewport(viewportHeight, fovy);
  return (metersPerPixel(zoom, latitude) * viewportHeight) / 2 / Math.tan(fovy / 2);
}

/** 相机到画布中心地面点的距离换成缩放级；在地下、贴着地面时按 1 米算，得到有限的级别 */
export function distanceToZoom(distance: number, latitude: number, viewportHeight: number, fovy: number): number {
  assertViewport(viewportHeight, fovy);
  const meters = (2 * Math.max(1, Math.abs(distance)) * Math.tan(fovy / 2)) / viewportHeight;
  return Math.log2((METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) / meters);
}

/** Cesium 透视视锥的 fov：宽屏（宽高比大于 1）时它表示水平视场角，要按竖直视场角换算 */
export function frustumFov(fovy: number, aspect: number): number {
  return aspect > 1 ? 2 * Math.atan(Math.tan(fovy / 2) * aspect) : fovy;
}

/** 写进三维相机的俯角（度，0 是正俯视）：正俯视时抬高一点，保住方位 */
export function writablePitch(pitch: number): number {
  return Math.max(pitch, NADIR_EPSILON);
}

/** 从三维相机读回的俯角：写入时抬高的那一点归零 */
export function readablePitch(pitch: number): number {
  return pitch <= NADIR_EPSILON * 2 ? 0 : pitch;
}

// 读回的方位离 360° 小于这个值（度）时当作 0：解算出的 -0.00000001° 取模后会变成 359.99999999°
const FULL_TURN_EPSILON = 1e-6;

/** 方位角归到 [0, 360) */
export function normalizeBearing(bearing: number): number {
  const value = ((bearing % 360) + 360) % 360;
  return value > 360 - FULL_TURN_EPSILON ? 0 : value;
}
