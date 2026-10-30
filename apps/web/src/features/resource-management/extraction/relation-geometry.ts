import type { RelationKind } from './relation-graph';
import type { RelationEdge } from './relation-view';

/** 卡片在舞台里的位置，单位是未缩放的 CSS 像素 */
export interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeShape {
  key: string;
  kind: RelationKind;
  /** SVG path 的 d */
  path: string;
  /** 放关系名称的位置 */
  label: { x: number; y: number };
  /** 合成了几条关系 */
  count: number;
  /** 和悬停或选中的节点相连 */
  focused: boolean;
}

// 同一泳道的弧线从卡片右缘向外鼓：第一条 12，之后每条多 8，成对交错时不完全重叠
const SAME_LANE_BULGE = 12;
const SAME_LANE_STEP = 8;

// 跨泳道：从左边卡片的右缘到右边卡片的左缘，两端水平出入
function crossLane(a: CardBox, b: CardBox): Pick<EdgeShape, 'path' | 'label'> {
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  const x1 = left.x + left.width;
  const y1 = left.y + left.height / 2;
  const x2 = right.x;
  const y2 = right.y + right.height / 2;
  const half = (x2 - x1) / 2;
  return {
    path: `M${x1} ${y1} C${x1 + half} ${y1} ${x2 - half} ${y2} ${x2} ${y2}`,
    label: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
  };
}

// 同一泳道：两张卡片右侧的弧线
function sameLane(a: CardBox, b: CardBox, bulge: number): Pick<EdgeShape, 'path' | 'label'> {
  const edge = Math.max(a.x + a.width, b.x + b.width) + bulge;
  const y1 = a.y + a.height / 2;
  const y2 = b.y + b.height / 2;
  return {
    path: `M${a.x + a.width} ${y1} C${edge} ${y1} ${edge} ${y2} ${b.x + b.width} ${y2}`,
    label: { x: Math.max(a.x + a.width, b.x + b.width) + bulge * 0.75, y: (y1 + y2) / 2 }
  };
}

/** 关系线的形状：缺少卡片位置的线不画；和焦点相连的排在最后，画在最上层 */
export function edgeShapes(
  edges: readonly RelationEdge[],
  boxes: ReadonlyMap<string, CardBox>,
  laneOf: ReadonlyMap<string, number>,
  focus: string | null
): EdgeShape[] {
  const measured = edges.flatMap(edge => {
    const a = boxes.get(edge.from);
    const b = boxes.get(edge.to);
    return a && b ? [{ edge, a, b }] : [];
  });
  const sameLaneKeys = measured
    .filter(({ edge }) => laneOf.get(edge.from) === laneOf.get(edge.to))
    .toSorted((first, second) => first.a.y - second.a.y)
    .map(({ edge }) => edge.key);
  const shapes = measured.map(({ edge, a, b }): EdgeShape => {
    const index = sameLaneKeys.indexOf(edge.key);
    const { path, label } = index < 0 ? crossLane(a, b) : sameLane(a, b, SAME_LANE_BULGE + index * SAME_LANE_STEP);
    return {
      key: edge.key,
      kind: edge.kind,
      path,
      label,
      count: edge.relations.length,
      focused: focus !== null && (edge.from === focus || edge.to === focus)
    };
  });
  return shapes.toSorted((first, second) => Number(first.focused) - Number(second.focused));
}
