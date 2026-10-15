/** 缩放范围，和画布的 minZoom、maxZoom 相同（如 JIANGSU_ZOOM_RANGE） */
export interface ZoomRange {
  readonly minZoom: number;
  readonly maxZoom: number;
}

// 浮点误差：7.9999999 仍算 8 级
const EPSILON = 1e-6;

/**
 * 显示的层级：向下取整（ADR 0053 第 3 节）。面板的"放大至第 N 级显示"、点选的"14 级以上只用渲染要素"都按"级别 ≥ N"判断，
 * 四舍五入时 13.6 级会显示 14，但 14 级才有的东西并没有出来
 */
export function levelOf(zoom: number): number {
  return Math.floor(zoom + EPSILON);
}

/** 悬停时的完整提示：层级和一位小数的精确值 */
export function levelTitle(zoom: number): string {
  return `当前层级 ${levelOf(zoom)}（${zoom.toFixed(1)}）`;
}

/** 按钮缩放的目标级别：固定 ±1，截断在缩放范围里（ADR 0053 第 3 节） */
export function zoomTarget(from: number, step: 1 | -1, { minZoom, maxZoom }: ZoomRange): number {
  return Math.min(maxZoom, Math.max(minZoom, from + step));
}

/** 还能不能往这个方向缩放：到了范围的边界时不能 */
export function canZoom(from: number, step: 1 | -1, { minZoom, maxZoom }: ZoomRange): boolean {
  return step > 0 ? from < maxZoom - EPSILON : from > minZoom + EPSILON;
}

/** 上一次按钮缩放：目标级别和它的相机操作的信号 */
export interface PendingZoom {
  readonly target: number;
  readonly signal: AbortSignal;
}

/**
 * 这次按钮缩放从哪个级别算起：上一次按钮缩放的操作还有效时接着它的目标累计，不读动画的中间值；
 * 被新的操作（滚轮、拖动、默认视角、区划定位等）作废以后从当前相机的级别算起
 */
export function zoomBase(pending: PendingZoom | null, cameraZoom: number): number {
  return pending && !pending.signal.aborted ? pending.target : cameraZoom;
}

/** 滚轮和触控板的缩放速率（MapLibre 默认 1/450、1/100）：首轮先调低灵敏度，用普通鼠标和触控板实际试过后再定 */
export const SCROLL_ZOOM_RATES = { wheel: 1 / 600, trackpad: 1 / 150 } as const;
