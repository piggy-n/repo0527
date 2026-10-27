import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force';
import { childrenOf, type KnowledgeEdge, type KnowledgeNode, knowledgeNodes } from './knowledge-graph';

// 旧页面 useEnterpriseGraph 的布局：先按完整分类树排出扇形的初始位置，再对搜索出的子图跑固定次数的 D3 力导。
// 参数和次数照搬，由 legacy-layout.fixture.json（旧代码生成的坐标）逐个核对

export interface GraphPoint {
  x: number;
  y: number;
}

/** 节点圆的直径：按层级固定，文字排版和碰撞半径都用它 */
export function nodeSize(node: KnowledgeNode): number {
  if (node.level !== null && node.level >= 3) {
    return 57;
  }
  if (node.type === 'root') {
    return 145;
  }
  if (node.type === 'system') {
    return 115;
  }
  return node.type.endsWith('category') ? 98 : 77;
}

// 两个体系在根节点左右两侧，一级类在体系周围排成扇形：[体系, 圆心 x, 半径, 起止角度]
const SYSTEM_FANS = [
  ['survey', -390, 340, 112, 248],
  ['planning', 390, 360, -68, 68]
] as const;
// 下级节点每圈最多 7 个，第一圈半径 170，往外每圈加 96
const RING_SIZE = 7;
const RING_RADIUS = 170;
const RING_STEP = 96;
const SIMULATION_TICKS = 110;

function seedPositions(): Map<string, GraphPoint> {
  const positions = new Map<string, GraphPoint>(knowledgeNodes.map(node => [node.id, { x: 0, y: 0 }]));
  const place = (id: string, x: number, y: number) => positions.set(id, { x: Math.round(x), y: Math.round(y) });
  const positionOf = (id: string) => positions.get(id) ?? { x: 0, y: 0 };

  for (const [system, centerX, radius, start, end] of SYSTEM_FANS) {
    place(system, centerX, 0);
    const categories = childrenOf(system);
    const step = categories.length === 1 ? 0 : (end - start) / (categories.length - 1);
    categories.forEach((node, index) => {
      const degree = categories.length === 1 ? (start + end) / 2 : start + step * index;
      const angle = degree * Math.PI / 180;
      place(node.id, centerX + Math.cos(angle) * radius, Math.sin(angle) * radius);
    });
  }

  // 下级节点朝体系外侧展开；一个父节点的子级多时分几圈
  for (const node of knowledgeNodes) {
    if (node.level === null) {
      continue;
    }
    const children = childrenOf(node.id);
    const parent = positionOf(node.id);
    const system = positionOf(node.system === 'planning' ? 'planning' : 'survey');
    const base = Math.atan2(parent.y - system.y, parent.x - system.x);
    const fan = Math.min(Math.PI * 1.18, Math.max(Math.PI / 2.2, children.length * 0.24));
    children.forEach((child, index) => {
      const ring = Math.floor(index / RING_SIZE);
      const count = Math.min(RING_SIZE, children.length - ring * RING_SIZE);
      const angle = count === 1 ? base : base - fan / 2 + fan * (index % RING_SIZE) / (count - 1);
      const radius = RING_RADIUS + ring * RING_STEP;
      place(child.id, parent.x + Math.cos(angle) * radius, parent.y + Math.sin(angle) * radius);
    });
  }
  return positions;
}

const seeds = seedPositions();

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  node: KnowledgeNode;
  size: number;
  seed: GraphPoint;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  type: KnowledgeEdge['type'];
}

function charge({ node }: LayoutNode): number {
  if (node.type === 'root') {
    return -1200;
  }
  if (node.type === 'system') {
    return -760;
  }
  return node.level === 2 ? -520 : -300;
}

/** 子图的静态力导布局，同一子图每次结果相同；根节点固定在原点。模拟用副本，不改动图谱数据 */
export function layoutGraph(nodes: readonly KnowledgeNode[], edges: readonly KnowledgeEdge[]): Map<string, GraphPoint> {
  if (nodes.length <= 1) {
    return new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));
  }
  const points: LayoutNode[] = nodes.map(node => {
    const seed = seeds.get(node.id) ?? { x: 0, y: 0 };
    const fixed = node.type === 'root' ? 0 : undefined;
    return { id: node.id, node, size: nodeSize(node), seed, x: seed.x, y: seed.y, fx: fixed, fy: fixed };
  });
  const links: LayoutLink[] = edges.map(edge => ({ source: edge.source, target: edge.target, type: edge.type }));
  forceSimulation(points)
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .id(point => point.id)
        .distance(link => (link.type === 'contains' ? 190 : 300))
        .strength(link => (link.type === 'contains' ? 0.45 : 0.08))
    )
    .force('charge', forceManyBody<LayoutNode>().strength(charge))
    .force('collide', forceCollide<LayoutNode>().radius(point => point.size / 2 + 40).iterations(2))
    .force('x', forceX<LayoutNode>(point => point.seed.x).strength(0.06))
    .force('y', forceY<LayoutNode>(point => point.seed.y).strength(0.06))
    .stop()
    .tick(SIMULATION_TICKS);
  return new Map(points.map(point => [point.id, { x: point.x ?? 0, y: point.y ?? 0 }]));
}
