/** 悬浮元素贴着画布的哪一边（ADR 0029） */
export type OverlayEdge = 'top' | 'right' | 'bottom' | 'left';

/** 定位时在画布四边留出的像素，只用于计算，不留在相机上 */
export interface OverlayPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface OverlayOptions {
  /** 每一边至少留出的像素，让目标不贴着画布边；默认 16 */
  readonly edgePadding?: number;
  /** 被占用的边再多留的像素，让目标不贴着悬浮元素；默认 16 */
  readonly gap?: number;
  /** 可视区域的宽、高至少保留画布的这一比例，超出时两侧的 padding 按比例缩小；默认 1/3 */
  readonly minVisibleRatio?: number;
}

/** 与 getBoundingClientRect 相同的坐标 */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface MeasuredOverlay {
  readonly edge: OverlayEdge;
  readonly box: Box;
}

const DEFAULTS: Required<OverlayOptions> = { edgePadding: 16, gap: 16, minVisibleRatio: 1 / 3 };

/** 补上默认值并检查取值范围；不合法时抛错（编程错误） */
export function resolveOverlayOptions(options: OverlayOptions = {}): Required<OverlayOptions> {
  const resolved = {
    edgePadding: options.edgePadding ?? DEFAULTS.edgePadding,
    gap: options.gap ?? DEFAULTS.gap,
    minVisibleRatio: options.minVisibleRatio ?? DEFAULTS.minVisibleRatio
  };
  if (!(resolved.edgePadding >= 0) || !(resolved.gap >= 0)) {
    throw new RangeError('edgePadding、gap 不能为负数');
  }
  if (!(resolved.minVisibleRatio > 0 && resolved.minVisibleRatio <= 1)) {
    throw new RangeError('minVisibleRatio 要在 (0, 1] 之间');
  }
  return resolved;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function isVisible(box: Box): boolean {
  return box.right > box.left && box.bottom > box.top;
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// 一边占用的像素：贴左边的元素是它的右边缘到画布左边缘的距离，其余三边同理
const OCCUPIED: Readonly<Record<OverlayEdge, (box: Box, canvas: Box) => number>> = {
  left: (box, canvas) => box.right - canvas.left,
  right: (box, canvas) => canvas.right - box.left,
  top: (box, canvas) => box.bottom - canvas.top,
  bottom: (box, canvas) => canvas.bottom - box.top
};

// 两侧之和超过画布的 (1 - 比例) 时按比例缩小，保证可视区域至少占这一比例
function capPair(start: number, end: number, size: number, minVisibleRatio: number): [number, number] {
  const max = size * (1 - minVisibleRatio);
  const total = start + end;
  if (total <= max) {
    return [start, end];
  }
  const scale = max / total;
  return [Math.floor(start * scale), Math.floor(end * scale)];
}

/** 按悬浮元素的实际占用算出定位用的 padding（ADR 0029 第 2 条） */
export function computeOverlayPadding(
  canvas: Box,
  overlays: readonly MeasuredOverlay[],
  options: Required<OverlayOptions>
): OverlayPadding {
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  const occupied: Record<OverlayEdge, number> = { top: 0, right: 0, bottom: 0, left: 0 };
  if (width > 0 && height > 0) {
    for (const overlay of overlays) {
      if (isVisible(overlay.box) && intersects(overlay.box, canvas)) {
        const size = overlay.edge === 'left' || overlay.edge === 'right' ? width : height;
        const value = clamp(OCCUPIED[overlay.edge](overlay.box, canvas), size);
        occupied[overlay.edge] = Math.max(occupied[overlay.edge], value);
      }
    }
  }
  const side = (edge: OverlayEdge) =>
    Math.round(Math.max(options.edgePadding, occupied[edge] > 0 ? occupied[edge] + options.gap : 0));
  const [left, right] = capPair(side('left'), side('right'), width, options.minVisibleRatio);
  const [top, bottom] = capPair(side('top'), side('bottom'), height, options.minVisibleRatio);
  return { top, right, bottom, left };
}
