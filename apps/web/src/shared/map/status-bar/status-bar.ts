import type { CameraState } from '@yzt/map-core';

/** 比例尺的取样：画布中间的水平线上相距 100 像素的两点（ADR 0053 第 5 节） */
export const SCALE_SAMPLE_WIDTH = 100;
/** 比例尺线段最长 80 像素 */
export const SCALE_MAX_WIDTH = 80;

export interface ScaleBar {
  /** 线段代表的长度，单位是米：1、2、5 × 10ⁿ */
  readonly meters: number;
  /** 线段在屏幕上的长度，像素 */
  readonly width: number;
  readonly label: string;
}

/** 满 1000 米写 km */
export function formatLength(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

/**
 * 三维的视点高度（ADR 0080 第 6 节）：不到 1 km 写整米，不到 10 km 保留一位小数，再高写整千米；
 * 按取整后的值分档，不出现"1000 m""10.0 km"
 */
export function eyeHeightLabel(meters: number): string {
  const rounded = Math.max(0, Math.round(meters));
  if (rounded < 1000) {
    return `${rounded} m`;
  }
  if (meters < 9950) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters / 1000)} km`;
}

/** 取样两点的距离（米）换成比例尺：不超过 80 像素的整齐长度；距离不是正数时为 null */
export function scaleBar(sampleMeters: number): ScaleBar | null {
  if (!(Number.isFinite(sampleMeters) && sampleMeters > 0)) {
    return null;
  }
  const metersPerPixel = sampleMeters / SCALE_SAMPLE_WIDTH;
  const max = metersPerPixel * SCALE_MAX_WIDTH;
  const base = 10 ** Math.floor(Math.log10(max));
  // log10 的舍入误差让 base 略大于 max 时退一档
  const meters = [5, 2, 1].map(factor => factor * base).find(length => length <= max) ?? base / 2;
  return { meters, width: meters / metersPerPixel, label: formatLength(meters) };
}

/** 状态栏显示的角度：取整后为 0 的为 null */
export interface ViewAngles {
  /** 旋转，和 MapLibre 的 bearing 一样是 -179～180，小角度不会写成 358° */
  readonly bearing: number | null;
  readonly pitch: number | null;
}

/** 旋转、俯仰取整后不为 0 时才显示（ADR 0053 第 5 节） */
export function visibleAngles({ bearing, pitch }: Pick<CameraState, 'bearing' | 'pitch'>): ViewAngles {
  const wrapped = ((((Math.round(bearing) + 180) % 360) + 360) % 360) - 180;
  const rotation = wrapped === -180 ? 180 : wrapped;
  const tilt = Math.round(pitch);
  return { bearing: rotation === 0 ? null : rotation, pitch: tilt === 0 ? null : tilt };
}

/** 状态栏的三种排法，按优先顺序 */
export type StatusLayout = 'full' | 'no-angles' | 'scale-only';

const LAYOUTS: readonly StatusLayout[] = ['full', 'no-angles', 'scale-only'];

/**
 * 放不下时先去掉旋转和俯仰，再去掉经纬度，比例尺一直保留（ADR 0053 第 5 节）；widths 是各排法量出的宽度。
 * 还量不到可用宽度（测试环境没有布局）时全部显示
 */
export function fitStatusLayout(widths: Readonly<Record<StatusLayout, number>>, available: number): StatusLayout {
  if (!(available > 0)) {
    return 'full';
  }
  return LAYOUTS.find(layout => widths[layout] <= available) ?? 'scale-only';
}
