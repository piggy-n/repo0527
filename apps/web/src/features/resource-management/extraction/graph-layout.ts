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
import type { GraphEdge, GraphEdgeKind, GraphLayoutInput, GraphPoint, GraphViewport } from './graph-model';
import { labelLength, type MeasuredNode, measureNodes, nodeSizeAt } from './graph-text';

// 知识图谱的布局（ADR 0126）：力导得到结构，按画布铺开，再按节点大小解开重叠。同一输入每次结果相同，不改动图谱数据

/** 显示比例：节点和字号相对基准的倍数，从大到小试；大屏字更大，放不下时才小于 1（小节点的名称放大后出现） */
export const DISPLAY_SCALES = [1.2, 1.1, 1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.3, 0.24, 0.2];
/** 节点离画布边缘至少这么多 */
export const CANVAS_MARGIN = 24;

/** 节点边缘之间至少留这么多，关系名称才放得下 */
export function requiredClearance(displayScale: number): number {
  return 22 * Math.min(1, displayScale);
}

const DEFAULT_GAP = 40;
const DEFAULT_MAPPING_STRENGTH = 0.1;
// 上下级短而强、对应关系长而弱，和旧页面同一思路；距离是两个圆的半径加上这里的空隙
const LINK_STRENGTH: Partial<Record<GraphEdgeKind, number>> = { organize: 0.5, contains: 0.5, temporal: 0.2 };
const LINK_EXTRA: Partial<Record<GraphEdgeKind, number>> = {
  organize: 34,
  contains: 0,
  'class-mapping': 60,
  temporal: 24
};
const FORCE_TICKS = 240;
const RELAX_TICKS = 160;
// 按画布铺开时横向比纵向最多多拉开这么多倍
const MAX_STRETCH = 2.6;
// 铺开时给边上的节点留出一半直径
const SPREAD_INSET = 60;

interface LayoutPoint extends SimulationNodeDatum {
  id: string;
  node: MeasuredNode;
  r: number;
  seedX: number;
  seedY: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutPoint> {
  kind: GraphEdgeKind;
}

interface SpreadPoint extends SimulationNodeDatum {
  id: string;
  node: MeasuredNode;
  baseX: number;
  baseY: number;
}

function charge({ node }: LayoutPoint): number {
  if (node.kind === 'root') {
    return -800;
  }
  if (node.kind === 'system') {
    return -520;
  }
  return node.level === 1 ? -320 : -200;
}

function runForce(input: GraphLayoutInput, nodes: readonly MeasuredNode[]): LayoutPoint[] {
  const gap = input.gap ?? DEFAULT_GAP;
  const points: LayoutPoint[] = nodes.map(node => {
    const seed = input.seeds.get(node.id) ?? { x: 0, y: 0 };
    const fixed = node.kind === 'root' ? 0 : undefined;
    return {
      id: node.id,
      node,
      r: node.baseSize / 2,
      seedX: seed.x,
      seedY: seed.y,
      x: seed.x,
      y: seed.y,
      fx: fixed,
      fy: fixed
    };
  });
  const ids = new Set(points.map(point => point.id));
  const links: LayoutLink[] = input.edges
    .filter(edge => ids.has(edge.source) && ids.has(edge.target))
    .map(edge => ({ source: edge.source, target: edge.target, kind: edge.kind }));
  const radiusOf = (end: LayoutLink['source']) => (typeof end === 'object' ? end.r : 0);
  forceSimulation(points)
    .force(
      'link',
      forceLink<LayoutPoint, LayoutLink>(links)
        .id(point => point.id)
        .distance(link => radiusOf(link.source) + radiusOf(link.target) + gap + (LINK_EXTRA[link.kind] ?? 0))
        .strength(link =>
          link.kind === 'class-mapping'
            ? (input.mappingStrength ?? DEFAULT_MAPPING_STRENGTH)
            : (LINK_STRENGTH[link.kind] ?? 0.2)
        )
    )
    .force('charge', forceManyBody<LayoutPoint>().strength(charge))
    .force('collide', forceCollide<LayoutPoint>().radius(point => point.r + 14).iterations(3))
    .force('x', forceX<LayoutPoint>(point => point.seedX).strength(0.06))
    .force('y', forceY<LayoutPoint>(point => point.seedY).strength(0.06))
    .stop()
    .tick(FORCE_TICKS);
  return points;
}

// 按画布铺开：横纵可以不同比例，只改位置，圆不会被拉扁
function spread(points: readonly LayoutPoint[], viewport: GraphViewport): SpreadPoint[] {
  const xs = points.map(point => point.x ?? 0);
  const ys = points.map(point => point.y ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(1, Math.max(...xs) - minX);
  const spanY = Math.max(1, Math.max(...ys) - minY);
  let scaleX = (viewport.width - CANVAS_MARGIN * 2 - SPREAD_INSET) / spanX;
  let scaleY = (viewport.height - CANVAS_MARGIN * 2 - SPREAD_INSET) / spanY;
  if (scaleX > scaleY * MAX_STRETCH) {
    scaleX = scaleY * MAX_STRETCH;
  } else if (scaleY > scaleX * MAX_STRETCH) {
    scaleY = scaleX * MAX_STRETCH;
  }
  return points.map(point => ({
    id: point.id,
    node: point.node,
    baseX: ((point.x ?? 0) - minX - spanX / 2) * scaleX,
    baseY: ((point.y ?? 0) - minY - spanY / 2) * scaleY
  }));
}

interface RelaxResult {
  clearance: number;
  shortLinks: number;
  positions: Map<string, GraphPoint>;
}

// 按这个显示比例解开重叠：连线留够关系名称的长度，全程不出画布
function relax(
  base: readonly SpreadPoint[],
  edges: readonly GraphEdge[],
  displayScale: number,
  viewport: GraphViewport
): RelaxResult {
  const points: SpreadPoint[] = base.map(point => ({ ...point, x: point.baseX, y: point.baseY, vx: 0, vy: 0 }));
  const byId = new Map(points.map(point => [point.id, point]));
  const shrink = Math.min(1, displayScale);
  const links = edges.flatMap(edge => {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    return a && b ? [{ a, b, room: (labelLength(edge.label, 12) + 8) * shrink }] : [];
  });
  const radiusOf = (point: SpreadPoint) => nodeSizeAt(point.node, displayScale) / 2;
  const required = (link: (typeof links)[number]) => radiusOf(link.a) + radiusOf(link.b) + link.room;
  const simulation = forceSimulation(points)
    .force(
      'collide',
      forceCollide<SpreadPoint>()
        .radius(point => radiusOf(point) + 15 * shrink)
        .strength(0.9)
        .iterations(4)
    )
    .force('x', forceX<SpreadPoint>(point => point.baseX).strength(0.03))
    .force('y', forceY<SpreadPoint>(point => point.baseY).strength(0.03))
    .stop();
  const halfWidth = viewport.width / 2 - CANVAS_MARGIN;
  const halfHeight = viewport.height / 2 - CANVAS_MARGIN;
  for (let tick = 0; tick < RELAX_TICKS; tick += 1) {
    simulation.tick();
    for (const link of links) {
      const dx = (link.b.x ?? 0) - (link.a.x ?? 0);
      const dy = (link.b.y ?? 0) - (link.a.y ?? 0);
      const distance = Math.max(1, Math.hypot(dx, dy));
      const lack = required(link) - distance;
      if (lack > 0) {
        const push = (lack / distance) * 0.25;
        link.a.x = (link.a.x ?? 0) - dx * push;
        link.a.y = (link.a.y ?? 0) - dy * push;
        link.b.x = (link.b.x ?? 0) + dx * push;
        link.b.y = (link.b.y ?? 0) + dy * push;
      }
    }
    for (const point of points) {
      const r = radiusOf(point);
      point.x = Math.min(halfWidth - r, Math.max(r - halfWidth, point.x ?? 0));
      point.y = Math.min(halfHeight - r, Math.max(r - halfHeight, point.y ?? 0));
    }
  }
  let clearance = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      const distance = Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
      clearance = Math.min(clearance, distance - radiusOf(a) - radiusOf(b));
    }
  }
  const shortLinks = links.filter(link => {
    return Math.hypot((link.a.x ?? 0) - (link.b.x ?? 0), (link.a.y ?? 0) - (link.b.y ?? 0)) < required(link) - 1;
  }).length;
  return {
    clearance,
    shortLinks,
    positions: new Map(points.map(point => [point.id, { x: point.x ?? 0, y: point.y ?? 0 }]))
  };
}

/**
 * 布局：画布坐标，原点在画布中心。解开重叠用能放下的最大显示比例，节点太多时比例很小。
 * 比例小于 1 后节点已经缩到接近下限，再缩也腾不出多少地方：只要节点不重叠就接受，名称优先于关系名称的空间
 */
export function layoutGraph(input: GraphLayoutInput, viewport: GraphViewport): Map<string, GraphPoint> {
  const nodes = measureNodes(input.nodes);
  if (nodes.length <= 1) {
    return new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));
  }
  const base = spread(runForce(input, nodes), viewport);
  let result: RelaxResult | null = null;
  for (const displayScale of DISPLAY_SCALES) {
    result = relax(base, input.edges, displayScale, viewport);
    const roomForLabels = displayScale < 1 || result.shortLinks <= input.edges.length * 0.1;
    if (result.clearance >= requiredClearance(displayScale) && roomForLabels) {
      break;
    }
  }
  return result?.positions ?? new Map<string, GraphPoint>();
}
