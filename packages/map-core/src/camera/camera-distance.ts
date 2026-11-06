// 缩放级和相机距离的换算（ADR 0079 第 4 节），两种三维引擎共用：画布中心的地面比例与二维一致

/** MapLibre 6 的竖直视场角（弧度）：getVerticalFieldOfView() 的默认值 36.87° */
export const MAPLIBRE_FOVY = (36.86989764584402 * Math.PI) / 180;

// 赤道上 0 级、512 像素瓦片的每像素米数（MapLibre 的缩放级口径）
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.516964;

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
