import type { ScreenBox, ScreenPoint } from '@yzt/map-core';

// 拖动框选的手势（ADR 0049 第 1 节）：纯函数，工具的拥有者持有状态、按指针事件推进

/** 离起点不小于这个距离时进入框选：MapLibre 只在按下点和松手点相距不到 3 像素（默认的单击容差）时发出单击 */
export const BOX_START_DISTANCE = 3;

/** 一次手势的状态 */
export type BoxGesture =
  /** 没有按下；suppressClick 表示上一次手势进入过框选或被取消，屏蔽它派生的单击，到下一次按下才重置 */
  | { readonly kind: 'idle'; readonly suppressClick: boolean }
  /** 左键按下，还没离开起点 */
  | { readonly kind: 'pressed'; readonly start: ScreenPoint }
  /** 正在框选 */
  | { readonly kind: 'drawing'; readonly start: ScreenPoint; readonly current: ScreenPoint };

export const NO_BOX_GESTURE: BoxGesture = Object.freeze({ kind: 'idle', suppressClick: false });

// 结束了一次框选或取消后的状态：屏蔽这次手势派生的单击
const SUPPRESSED: BoxGesture = Object.freeze({ kind: 'idle', suppressClick: true });

function farEnough(from: ScreenPoint, to: ScreenPoint): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= BOX_START_DISTANCE;
}

/** 左键按下：开始新的手势，解除上一次手势的单击屏蔽 */
export function pressBox(point: ScreenPoint): BoxGesture {
  return { kind: 'pressed', start: point };
}

/** 指针移动：离起点不小于阈值时进入框选，之后跟着更新当前点；没有按下时不变 */
export function moveBox(gesture: BoxGesture, point: ScreenPoint): BoxGesture {
  if (gesture.kind === 'drawing') {
    return { ...gesture, current: point };
  }
  if (gesture.kind === 'pressed' && farEnough(gesture.start, point)) {
    return { kind: 'drawing', start: gesture.start, current: point };
  }
  return gesture;
}

/**
 * 松手：框选中时结束并屏蔽这次的单击，给出框；拖回起点附近、框太小时没有框。
 * 只是按下过的交给单击；松手点离起点够远时，即使没收到移动也按框选处理
 */
export function releaseBox(gesture: BoxGesture, point: ScreenPoint): { gesture: BoxGesture; box: ScreenBox | null } {
  const moved = moveBox(gesture, point);
  if (moved.kind === 'pressed') {
    return { gesture: NO_BOX_GESTURE, box: null };
  }
  if (moved.kind === 'idle') {
    return { gesture: moved, box: null };
  }
  const { start } = moved;
  const large = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y)) >= BOX_START_DISTANCE;
  return { gesture: SUPPRESSED, box: large ? { from: start, to: point } : null };
}

/** 取消（Esc、地图移动、失焦、离开画布）：结束按下或框选中的手势，屏蔽它派生的单击；没有手势时不变 */
export function cancelBox(gesture: BoxGesture): BoxGesture {
  return gesture.kind === 'idle' ? gesture : SUPPRESSED;
}

/** 收到的单击是不是一次正常的单击，而不是框选或取消的手势派生的 */
export function acceptsClick(gesture: BoxGesture): boolean {
  return gesture.kind === 'idle' && !gesture.suppressClick;
}

/** 正在画的框，浮层用它显示；没有在框选时为 null */
export function drawingBox(gesture: BoxGesture): ScreenBox | null {
  return gesture.kind === 'drawing' ? { from: gesture.start, to: gesture.current } : null;
}
