// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RouteCorner } from './roam.ts';
import { cornerLine, cornerSummary } from './roam-report.ts';

const corner = (reason: RouteCorner['reason'], offset: number): RouteCorner => ({
  distance: 123.456,
  x: 1.23,
  y: -4.56,
  offset,
  reason,
  at: { x: 1.5, y: -4.25 }
});

describe('cornerSummary', () => {
  it('按原因计数，没有的原因不列；容差以内的另计', () => {
    const corners = [corner('deviation', 3), corner('headroom', 0.4), corner('headroom', 0.6), corner('side-ground', 1.5)];
    expect(cornerSummary(corners, 1)).toBe(
      '拉直以后留下 4 个拐点，离前后拐点连线不到 1 米的 2 个：' +
        '水平偏离超过容差 1（不到 1 米的 0）、中线头顶余量不够 2（不到 1 米的 2）、两侧脚下没有地面 1（不到 1 米的 0）'
    );
    expect(cornerSummary([], 1)).toBe('拉直以后留下 0 个拐点，离前后拐点连线不到 1 米的 0 个');
  });
});

describe('cornerLine', () => {
  it('轨迹上的米数、局部坐标、离连线多远、原因和位置', () => {
    expect(cornerLine(corner('obstacle', 0.345))).toBe(
      '   123.5 米：局部 (1.2, -4.6)，离连线 0.34 米，中线身高范围有东西，在 (1.5, -4.3)'
    );
  });
});
