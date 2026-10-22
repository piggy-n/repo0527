import type { LabelPosition, MapLabel } from './types';

// 优先保留地理锚点，在密集区域选择距离最近的可用标签位置
export function layoutMapLabels(positions: readonly LabelPosition[], width: number, height: number) {
  const scale = Math.max(0.65, Math.min(1.8, width / 970, height / 760));
  // 仅窄屏为最小字号预留高度；桌面沿用旧锚点间距，避免无碰撞时把标签推离城市
  const labelHeight = Math.max(width <= 720 ? 50 : 40, 50 * scale);
  const placed: MapLabel[] = [];
  const ordered = positions.toSorted((a, b) => a.y - b.y);

  ordered.forEach(position => {
    const labelWidth = Math.max(64, position.name.length * 20 * scale + 12);
    const halfWidth = labelWidth / 2 + 3;
    const halfHeight = labelHeight / 2 + 3;
    const candidates = [[0, 0]];
    for (let ring = 1; ring <= 3; ring++) {
      candidates.push(
        [0, -labelHeight * ring],
        [0, labelHeight * ring],
        [-labelWidth * ring * 0.7, 0],
        [labelWidth * ring * 0.7, 0]
      );
      candidates.push(
        [-labelWidth * ring * 0.6, -labelHeight * ring * 0.7],
        [labelWidth * ring * 0.6, labelHeight * ring * 0.7]
      );
    }
    let best: MapLabel | undefined;
    let lowestScore = Infinity;

    function consider(candidateX: number, candidateY: number): void {
      const x = Math.max(halfWidth, Math.min(width - halfWidth, candidateX));
      const y = Math.max(halfHeight, Math.min(height - halfHeight, candidateY));
      const collisions = placed.filter(label => {
        const overlapsX = Math.abs(x - label.x) < halfWidth + label.halfWidth;
        const overlapsY = Math.abs(y - label.y) < halfHeight + label.halfHeight;
        return overlapsX && overlapsY;
      }).length;
      const distance = Math.hypot(x - position.x, y - position.y);
      const score = collisions * 10000 + distance;
      if (score < lowestScore) {
        lowestScore = score;
        best = {
          ...position,
          x,
          y,
          anchorX: position.x,
          anchorY: position.y,
          halfWidth,
          halfHeight,
          connected: distance > 12
        };
      }
    }

    candidates.forEach(([dx, dy]) => consider(position.x + dx, position.y + dy));
    // 局部候选全被占用时再搜索容器空位，避免窄屏回退到重叠位置
    if (lowestScore >= 10000) {
      for (let y = halfHeight; y <= height - halfHeight; y += halfHeight) {
        for (let x = halfWidth; x <= width - halfWidth; x += halfWidth) {
          consider(x, y);
        }
      }
    }
    if (best) {
      placed.push(best);
    }
  });
  // 已确定的避让结果不参与 Hover 运算，避免牵动相邻城市
  return {
    scale,
    labels: positions.map(position => {
      const label = placed.find(item => item.code === position.code)!;
      const dx = position.offsetX || 0;
      const dy = position.offsetY || 0;
      return { ...label, x: label.x + dx, y: label.y + dy, anchorX: label.anchorX + dx, anchorY: label.anchorY + dy };
    })
  };
}
