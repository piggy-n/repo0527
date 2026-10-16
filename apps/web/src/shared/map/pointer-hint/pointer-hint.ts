import type { ScreenPoint } from '@yzt/map-core';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** 提示在鼠标的哪一侧 */
export interface HintSides {
  readonly x: 'right' | 'left';
  readonly y: 'below' | 'above';
}

// 默认在鼠标右下方 16 像素（避开光标），离画布边缘至少留 8
const OFFSET = 16;
const MARGIN = 8;

// 一条轴上放在鼠标后面会超出画布；还不知道画布尺寸（为 0）时不算超出
function overflows(position: number, size: number, limit: number): boolean {
  return limit > 0 && position + OFFSET + size > limit - MARGIN;
}

/** 提示默认在鼠标右下方，右边、下边放不下时翻到另一侧（设计稿 5D.7） */
export function pointerHintSides(pointer: ScreenPoint, hint: Size, canvas: Size): HintSides {
  return {
    x: overflows(pointer.x, hint.width, canvas.width) ? 'left' : 'right',
    y: overflows(pointer.y, hint.height, canvas.height) ? 'above' : 'below'
  };
}
