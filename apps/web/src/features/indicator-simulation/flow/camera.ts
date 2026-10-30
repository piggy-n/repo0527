import type { FlowFrame } from './frame';
import { FLOW_LAYOUT, type FlowPlan } from './plan';

/** 看流程图的方式：跟随正在执行的一列，或者看整棵树 */
export type FlowView = 'follow' | 'overview';

/** 画布的平移和缩放：世界坐标 × scale + (x, y) = 视口坐标 */
export interface FlowCamera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** 底部被浮层（推演完成的卡片）挡住的高度 */
  readonly bottom: number;
}

// 全览最小缩放：再小就看不清字了，放不下时两端裁掉、可以拖动
const MIN_SCALE = 0.6;
// 跟随时正在执行的一列放在可视区横向的这个位置
const FOCUS_AT = 0.6;
const MARGIN = 12;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * 镜头的位置：全览时缩放到放下整棵树（不小于 0.6）居中；跟随时不缩放，放得下的方向居中，
 * 放不下时横向让正在执行的一列在六成处、纵向让进行中的节点在中间，两端不露出空白
 */
export function flowCamera(plan: FlowPlan, frame: FlowFrame, viewport: Viewport, view: FlowView): FlowCamera {
  const { width, height } = plan;
  const room = viewport.height - viewport.bottom;
  if (view === 'overview') {
    const fit = Math.min((viewport.width - MARGIN * 2) / width, (room - MARGIN * 2) / height);
    const scale = clamp(fit, MIN_SCALE, 1);
    return { scale, x: (viewport.width - width * scale) / 2, y: Math.max(MARGIN, (room - height * scale) / 2) };
  }
  const { nodeWidth, nodeHeight, columnGap, padX } = FLOW_LAYOUT;
  let x = (viewport.width - width) / 2;
  if (width > viewport.width) {
    const column = frame.column ?? 0;
    const focus = padX + column * (nodeWidth + columnGap) + nodeWidth / 2;
    x = clamp(viewport.width * FOCUS_AT - focus, viewport.width - width, 0);
  }
  let y = (room - height) / 2;
  if (height > room) {
    const active = plan.nodes.filter(node => frame.nodes.get(node.key)?.status === 'running');
    const middle =
      active.length > 0 ? active.reduce((sum, node) => sum + node.y + nodeHeight / 2, 0) / active.length : 0;
    y = clamp(room / 2 - middle, room - height, 0);
  }
  return { scale: 1, x, y };
}
