// 拉直的诊断（lcc2:register --route 时打印）：每条路线拉直以后留下的拐点按原因计数，--diagnose 时逐个列出
import type { CornerReason, RouteCorner } from './roam.ts';

/** 拐点留下的原因，按这个顺序列 */
export const CORNER_REASONS: Readonly<Record<CornerReason, string>> = {
  deviation: '水平偏离超过容差',
  ground: '中线脚下没有地面',
  headroom: '中线头顶余量不够',
  obstacle: '中线身高范围有东西',
  'side-ground': '两侧脚下没有地面',
  'side-headroom': '两侧头顶余量不够',
  'side-obstacle': '两侧身高范围有东西'
};

const reasons = Object.keys(CORNER_REASONS) as CornerReason[];

/** 一条路线的拐点按原因计数（一行）；离前后拐点连线不到 tolerance 米的（容差以内、没拉直的）另计 */
export function cornerSummary(corners: readonly RouteCorner[], tolerance: number): string {
  const small = corners.filter(({ offset }) => offset < tolerance);
  const counts = reasons.flatMap(reason => {
    const all = corners.filter(corner => corner.reason === reason).length;
    const within = small.filter(corner => corner.reason === reason).length;
    return all === 0 ? [] : [`${CORNER_REASONS[reason]} ${all}（不到 ${tolerance} 米的 ${within}）`];
  });
  return (
    `拉直以后留下 ${corners.length} 个拐点，离前后拐点连线不到 ${tolerance} 米的 ${small.length} 个` +
    (counts.length > 0 ? `：${counts.join('、')}` : '')
  );
}

/** 一个拐点（一行）：轨迹上的米数、局部坐标、离前后拐点连线多远、原因、直线上第一个过不去的位置和挡住的表面离地多高 */
export function cornerLine({ distance, x, y, offset, reason, at }: RouteCorner): string {
  const above = at.above === undefined ? '' : `，离地 ${at.above.toFixed(2)} 米`;
  return (
    `${distance.toFixed(1).padStart(8)} 米：局部 (${x.toFixed(1)}, ${y.toFixed(1)})，离连线 ${offset.toFixed(2)} 米，` +
    `${CORNER_REASONS[reason]}，在 (${at.x.toFixed(1)}, ${at.y.toFixed(1)})${above}`
  );
}
