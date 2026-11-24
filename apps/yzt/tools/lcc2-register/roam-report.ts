// 打印的诊断：拉直（--route 时）每条路线留下的拐点按原因计数，--diagnose 时逐个列出；断口候选（--roam 时，ADR 0170）
import type { CornerReason, RouteCorner, Stretch } from './roam.ts';
import type { WalkwayGap } from './walkway.ts';

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

/** 一条路线用的容差（一行里的括号）：路线的容差，和这条路线有交集的 --straight 段按写的顺序列（重叠时写在后面的算数） */
export function toleranceLabel(
  span: { readonly from: number; readonly to: number },
  tolerance: number,
  stretches: readonly Stretch[]
): string {
  const parts = stretches
    .filter(stretch => stretch.from < span.to && stretch.to > span.from)
    .map(stretch => `轨迹 ${stretch.from}～${stretch.to} 米 ${stretch.tolerance} 米`);
  return [`容差 ${tolerance} 米`, ...parts].join('，');
}

/** 一条路线的拐点按原因计数（一行）；离前后拐点连线不到所在处容差的（容差以内、没拉直的）另计 */
export function cornerSummary(corners: readonly RouteCorner[]): string {
  const small = corners.filter(({ offset, tolerance }) => offset < tolerance);
  const counts = reasons.flatMap(reason => {
    const all = corners.filter(corner => corner.reason === reason).length;
    const within = small.filter(corner => corner.reason === reason).length;
    return all === 0 ? [] : [`${CORNER_REASONS[reason]} ${all}（不到容差的 ${within}）`];
  });
  return (
    `拉直以后留下 ${corners.length} 个拐点，离前后拐点连线不到所在处容差的 ${small.length} 个` +
    (counts.length > 0 ? `：${counts.join('、')}` : '')
  );
}

/** 一个拐点（一行）：轨迹上的米数、局部坐标、离前后拐点连线多远和这一处的容差、原因、直线上第一个过不去的位置和挡住的表面离地多高 */
export function cornerLine({ distance, x, y, offset, tolerance, reason, at }: RouteCorner): string {
  const above = at.above === undefined ? '' : `，离地 ${at.above.toFixed(2)} 米`;
  return (
    `${distance.toFixed(1).padStart(8)} 米：局部 (${x.toFixed(1)}, ${y.toFixed(1)})，` +
    `离连线 ${offset.toFixed(2)} 米（容差 ${tolerance} 米），${CORNER_REASONS[reason]}，在 (${at.x.toFixed(1)}, ${at.y.toFixed(1)})${above}`
  );
}

/** 断口候选的一行（ADR 0170）：起止、长度、各种"断"的个数、建议的 --walkway */
export function gapLine(gap: WalkwayGap, span: { readonly from: number; readonly to: number }): string {
  const counts = [
    gap.jumps > 0 ? `${gap.jumps} 处和前一个点差一级台阶以上` : '',
    gap.sunken > 0 ? `${gap.sunken} 个点陷在坑里` : '',
    gap.holes > 0 ? `${gap.holes} 个点脚下没有网格` : ''
  ].filter(Boolean);
  return (
    `  ${gap.from.toFixed(1)}～${gap.to.toFixed(1)} 米（${(gap.to - gap.from).toFixed(1)} 米，${gap.samples} 个取样点）：` +
    `${counts.join('，')}；建议 --walkway ${span.from}-${span.to}`
  );
}
