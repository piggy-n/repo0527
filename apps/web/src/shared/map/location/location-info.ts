import type { ScreenPoint } from '@yzt/map-core';
import type { OverlayPadding } from '@yzt/map-vue';
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
  /** 指向图钉的小三角的中心，离卡片左边的距离 */
  readonly caret: number;
}

// 图钉的尖端在坐标上：上方留出图钉的高度，下方留出名称的高度
const ABOVE_GAP = 40;
const BELOW_GAP = 28;
// 小三角离卡片左右两边至少留出的距离，不压到圆角
const CARET_INSET = 18;

/**
 * 位置信息放在图钉上方，放不下时翻到下方（ADR 0037 第 5 条）。只放在可视区域里：画布去掉登记的悬浮元素，
 * 同定位用的 padding（ADR 0029，设计稿 5D.7）；可视区域比它窄时靠左。小三角对着图钉，最多到卡片两边
 */
export function placeLocationInfo(
  anchor: ScreenPoint,
  info: Size,
  canvas: Size,
  padding: OverlayPadding
): InfoPlacement {
  const right = canvas.width - padding.right;
  const above = anchor.y - ABOVE_GAP - info.height;
  const left = Math.max(padding.left, Math.min(anchor.x - info.width / 2, right - info.width));
  const caret = Math.min(Math.max(anchor.x - left, CARET_INSET), info.width - CARET_INSET);
  if (above >= padding.top) {
    return { left, top: above, side: 'above', caret };
  }
  return { left, top: anchor.y + BELOW_GAP, side: 'below', caret };
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
