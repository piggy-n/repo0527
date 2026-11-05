// 完整地图的取景（ADR 0087）：正北朝上的平面，中心点（米）和比例（CSS 像素每米）

/** 完整地图的视野：中心在平面里的坐标（米），scale 是 CSS 像素每米 */
export interface MapCamera {
  readonly east: number;
  readonly north: number;
  readonly scale: number;
}

export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

/** 一块图在平面里的范围（米） */
export interface PlaneBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** 最大放大：每米 24 像素 */
export const MAX_SCALE = 24;
// 打开时至少显示这么宽（米）；整层更窄就整层显示
const OPEN_METERS = 150;

/**
 * 打开地图、"定位到我"时的取景：整层放得进 150 米宽以内就整层显示，否则以人为中心显示 150 米宽；
 * minScale 是缩小的下限（整层放得下再缩一点）
 */
export function fitCamera(
  box: PlaneBox,
  view: ViewSize,
  player: readonly [number, number]
): { readonly camera: MapCamera; readonly minScale: number } {
  const width = Math.max(view.width, 1);
  const height = Math.max(view.height, 1);
  const fit = Math.min(width / box.width, height / box.height);
  const minScale = Math.min(fit * 0.8, MAX_SCALE);
  const scale = Math.min(Math.max(fit, width / OPEN_METERS), MAX_SCALE);
  const whole = scale === fit;
  return {
    camera: {
      east: whole ? box.left + box.width / 2 : player[0],
      north: whole ? box.top - box.height / 2 : player[1],
      scale
    },
    minScale
  };
}

/** 换一层看：位置和比例不变（对照上下层的同一片），比例不小于新楼层的下限 */
export function keepCamera(camera: MapCamera, box: PlaneBox, view: ViewSize): { camera: MapCamera; minScale: number } {
  const fit = Math.min(Math.max(view.width, 1) / box.width, Math.max(view.height, 1) / box.height);
  const minScale = Math.min(fit * 0.8, MAX_SCALE);
  return { camera: { ...camera, scale: Math.max(camera.scale, minScale) }, minScale };
}

/** 画布上的点（CSS 像素，左上角为原点）→ 平面里的坐标 */
export function screenToPlane(camera: MapCamera, view: ViewSize, x: number, y: number): [east: number, north: number] {
  return [camera.east + (x - view.width / 2) / camera.scale, camera.north - (y - view.height / 2) / camera.scale];
}

/** 平面里的坐标 → 画布上的点 */
export function planeToScreen(camera: MapCamera, view: ViewSize, east: number, north: number): [x: number, y: number] {
  return [
    view.width / 2 + (east - camera.east) * camera.scale,
    view.height / 2 - (north - camera.north) * camera.scale
  ];
}

/** 以画布上的 (x, y) 为不动点缩放 factor 倍，比例限制在 minScale～MAX_SCALE */
export function zoomCamera(
  camera: MapCamera,
  view: ViewSize,
  factor: number,
  minScale: number,
  x = view.width / 2,
  y = view.height / 2
): MapCamera {
  const [east, north] = screenToPlane(camera, view, x, y);
  const scale = Math.min(Math.max(camera.scale * factor, minScale), MAX_SCALE);
  return {
    east: east - (x - view.width / 2) / scale,
    north: north + (y - view.height / 2) / scale,
    scale
  };
}

/** 拖动：画面跟着鼠标走 (dx, dy) 像素 */
export function panCamera(camera: MapCamera, dx: number, dy: number): MapCamera {
  return { ...camera, east: camera.east - dx / camera.scale, north: camera.north + dy / camera.scale };
}

/** 比例尺：不超过 maxPixels 的整齐长度（1、2、5 × 10ⁿ 米）和它的像素长度 */
export function scaleBar(scale: number, maxPixels: number): { readonly meters: number; readonly pixels: number } {
  const max = maxPixels / scale;
  const base = 10 ** Math.floor(Math.log10(max));
  const meters = [5, 2, 1].map(step => step * base).find(length => length <= max * (1 + 1e-9)) ?? base;
  return { meters, pixels: meters * scale };
}
