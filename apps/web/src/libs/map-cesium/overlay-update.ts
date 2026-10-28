import type { Position } from 'geojson';
import type { OverlayLayer, OverlayShape, RgbaColor } from './overlay-plan';

/**
 * 一个图层只换坐标时，线和面的点数合计的上限（ADR 0082）：只换坐标的线和面改成每帧读取，Cesium 每帧都在主线程上重建它们的几何，
 * 测量线几十个点没有影响，边界上万个点一帧要几百毫秒
 */
export const LIVE_POINT_LIMIT = 500;

function sameColor(a: RgbaColor, b: RgbaColor): boolean {
  return a.every((value, index) => value === b[index]);
}

// 样式完全相同的两个形状：坐标可以直接换，不用重建实体
function sameStyle(a: OverlayShape, b: OverlayShape): boolean {
  if (a.kind === 'line' && b.kind === 'line') {
    return (
      sameColor(a.color, b.color) &&
      a.width === b.width &&
      a.dash?.length === b.dash?.length &&
      a.dash?.pattern === b.dash?.pattern
    );
  }
  if (a.kind === 'polygon' && b.kind === 'polygon') {
    return sameColor(a.color, b.color);
  }
  if (a.kind === 'point' && b.kind === 'point') {
    return (
      a.radius === b.radius &&
      a.strokeWidth === b.strokeWidth &&
      sameColor(a.color, b.color) &&
      sameColor(a.strokeColor, b.strokeColor)
    );
  }
  return false;
}

function samePosition(a: Position, b: Position | undefined): boolean {
  return b !== undefined && a.length === b.length && a.every((value, axis) => value === b[axis]);
}

function samePath(a: readonly Position[], b: readonly Position[] | undefined): boolean {
  return b !== undefined && a.length === b.length && a.every((position, index) => samePosition(position, b[index]));
}

/** 两个形状的坐标完全相同：再推导一次（跨级、换了数据对象）坐标没变时不用动它，也不改成每帧读取（ADR 0099） */
export function sameCoordinates(a: OverlayShape, b: OverlayShape): boolean {
  if (a.kind === 'line' && b.kind === 'line') {
    return samePath(a.path, b.path);
  }
  if (a.kind === 'polygon' && b.kind === 'polygon') {
    return a.rings.length === b.rings.length && a.rings.every((ring, index) => samePath(ring, b.rings[index]));
  }
  if (a.kind === 'point' && b.kind === 'point') {
    return samePosition(a.position, b.position);
  }
  return false;
}

// 每帧读取时要重建几何的点数；点的位置本来就每帧更新，不算
function livePoints(shapes: readonly OverlayShape[]): number {
  let count = 0;
  for (const shape of shapes) {
    if (shape.kind === 'line') {
      count += shape.path.length;
    } else if (shape.kind === 'polygon') {
      count += shape.rings.reduce((sum, ring) => sum + ring.length, 0);
    }
  }
  return count;
}

/** 图层换了形状时能不能只换坐标、不重建实体：形状个数和样式都没变，换之后线和面的点数不超过上限 */
export function movableInPlace(previous: OverlayLayer, next: OverlayLayer): boolean {
  return (
    next.shapes.length === previous.shapes.length &&
    next.shapes.every((shape, index) => sameStyle(shape, previous.shapes[index] ?? shape)) &&
    livePoints(next.shapes) <= LIVE_POINT_LIMIT
  );
}
