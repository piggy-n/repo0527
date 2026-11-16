// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RouteCorner } from './roam.ts';
import { cornerLine, cornerSummary, toleranceLabel } from './roam-report.ts';

const corner = (reason: RouteCorner['reason'], offset: number, tolerance = 1): RouteCorner => ({
  distance: 123.456,
  x: 1.23,
  y: -4.56,
  offset,
  tolerance,
  reason,
  at: { x: 1.5, y: -4.25 }
});

describe('cornerSummary', () => {
  it('按原因计数，没有的原因不列；离连线不到所在处容差的另计', () => {
    const corners = [corner('deviation', 3), corner('headroom', 0.4), corner('headroom', 0.6), corner('side-ground', 1.5)];
    expect(cornerSummary(corners)).toBe(
      '拉直以后留下 4 个拐点，离前后拐点连线不到所在处容差的 2 个：' +
        '水平偏离超过容差 1（不到容差的 0）、中线头顶余量不够 2（不到容差的 2）、两侧脚下没有地面 1（不到容差的 0）'
    );
    expect(cornerSummary([])).toBe('拉直以后留下 0 个拐点，离前后拐点连线不到所在处容差的 0 个');
  });

  it('各拐点按自己所在处的容差分（--straight 的段里容差大）', () => {
    // 离连线 1.5 米：在容差 1 米的地方不算没拉直的，在容差 3 米的段里算
    const corners = [corner('obstacle', 1.5, 1), corner('obstacle', 1.5, 3)];
    expect(cornerSummary(corners)).toBe(
      '拉直以后留下 2 个拐点，离前后拐点连线不到所在处容差的 1 个：中线身高范围有东西 2（不到容差的 1）'
    );
  });
});

describe('toleranceLabel', () => {
  it('路线的容差，加上和这条路线有交集的 --straight 段，按写的顺序', () => {
    const stretches = [
      { from: 15, to: 50, tolerance: 3 },
      { from: 300, to: 320, tolerance: 2 },
      { from: 540, to: 598, tolerance: 3 },
      { from: 560, to: 570, tolerance: 1.5 }
    ];
    expect(toleranceLabel({ from: 540, to: 700 }, 1, stretches)).toBe(
      '容差 1 米，轨迹 540～598 米 3 米，轨迹 560～570 米 1.5 米'
    );
    // 首尾只碰到一点的不算交集
    expect(toleranceLabel({ from: 50, to: 300 }, 2, stretches)).toBe('容差 2 米');
  });
});

describe('cornerLine', () => {
  it('轨迹上的米数、局部坐标、离连线多远和容差、原因、位置和挡住的表面离地多高', () => {
    expect(cornerLine({ ...corner('obstacle', 0.345, 3), at: { x: 1.5, y: -4.25, above: 0.91 } })).toBe(
      '   123.5 米：局部 (1.2, -4.6)，离连线 0.34 米（容差 3 米），中线身高范围有东西，在 (1.5, -4.3)，离地 0.91 米'
    );
  });
});
