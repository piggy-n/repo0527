import type { ScreenPoint } from '@yzt/map-core';
import { regionPath } from '../region/region-catalog';
import type { LocationRegion } from './useLocationPoint';

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface InfoPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: 'above' | 'below';
}

// 图钉的尖端在坐标上：上方留出图钉的高度，下方留出名称的高度；离画布边缘至少留 8
const ABOVE_GAP = 40;
const BELOW_GAP = 28;
const MARGIN = 8;

/** 位置信息放在图钉上方，放不下时翻到下方；左右不超出画布，画布比它窄时靠左（ADR 0037 第 5 条） */
export function placeLocationInfo(anchor: ScreenPoint, info: Size, canvas: Size): InfoPlacement {
  const above = anchor.y - ABOVE_GAP - info.height;
  const left = Math.max(MARGIN, Math.min(anchor.x - info.width / 2, canvas.width - info.width - MARGIN));
  if (above >= MARGIN) {
    return { left, top: above, side: 'above' };
  }
  return { left, top: anchor.y + BELOW_GAP, side: 'below' };
}

/** 位置信息里"所在区划"的文字 */
export function describeLocationRegion(region: LocationRegion): string {
  switch (region.kind) {
    case 'ready':
      return region.region ? regionPath(region.region) : '不在江苏省内';
    case 'loading':
      return '正在判断…';
    case 'failed':
      return '判断失败';
    case 'none':
      break;
  }
  return '-';
}
