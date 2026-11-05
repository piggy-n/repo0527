import type { CameraState, LngLat, ViewBounds, ViewPadding } from '@yzt/map-core';

// 三维的定位按二维的取景算出相机（ADR 0079 第 4 节）：Web 墨卡托、512 像素瓦片，和 MapLibre 的 fitBounds、offset 一致

const TILE_SIZE = 512;

export interface PaddingBox {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

function mercatorY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function lngOf(x: number): number {
  return x * 360 - 180;
}

function latOf(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/** 四边的留白 */
export function paddingBox(padding: ViewPadding | undefined): PaddingBox {
  if (padding === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  return typeof padding === 'number' ? { top: padding, right: padding, bottom: padding, left: padding } : padding;
}

/**
 * 让目标出现在去掉四边留白后的区域中央时，画布中心应该在哪里（ADR 0037）：
 * 区域中央相对画布中心的屏幕偏移，按方位角转到地图上，再按这一级的比例换成经纬度
 */
export function paddedCenter(target: LngLat, zoom: number, bearing: number, padding: ViewPadding | undefined): LngLat {
  const { top, right, bottom, left } = paddingBox(padding);
  const dx = (left - right) / 2;
  const dy = (top - bottom) / 2;
  if (dx === 0 && dy === 0) {
    return target;
  }
  const scale = 1 / (TILE_SIZE * 2 ** zoom);
  const radians = (bearing * Math.PI) / 180;
  const x = mercatorX(target[0]) - (dx * Math.cos(radians) - dy * Math.sin(radians)) * scale;
  const y = mercatorY(target[1]) - (dx * Math.sin(radians) + dy * Math.cos(radians)) * scale;
  return [lngOf(x), latOf(y)];
}

export interface FitOptions {
  readonly padding?: ViewPadding;
  readonly maxZoom?: number;
  /** 定位结束时的俯角；方位总是归零 */
  readonly pitch: number;
}

/** 和二维的 fitBounds 一样取景：范围放进去掉留白后的画布，方位为 0；范围是一个点时用 maxZoom（没有时 20 级） */
export function fitBoundsCamera(
  [west, south, east, north]: ViewBounds,
  { width, height }: CanvasSize,
  { padding, maxZoom, pitch }: FitOptions
): CameraState {
  const box = paddingBox(padding);
  const availableWidth = Math.max(1, width - box.left - box.right);
  const availableHeight = Math.max(1, height - box.top - box.bottom);
  const spanX = mercatorX(east) - mercatorX(west);
  const spanY = mercatorY(south) - mercatorY(north);
  const fitted = Math.log2(
    Math.min(availableWidth / (spanX * TILE_SIZE), availableHeight / (spanY * TILE_SIZE))
  );
  const limit = maxZoom ?? 20;
  const zoom = Number.isFinite(fitted) ? Math.min(fitted, limit) : limit;
  // 墨卡托坐标的中点，不是经纬度的平均
  const middle: LngLat = [
    lngOf((mercatorX(west) + mercatorX(east)) / 2),
    latOf((mercatorY(north) + mercatorY(south)) / 2)
  ];
  return { center: paddedCenter(middle, zoom, 0, padding), zoom, bearing: 0, pitch };
}
