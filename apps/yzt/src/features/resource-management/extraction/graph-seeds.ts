import type { GraphPoint } from './graph-model';
import { childrenOf, knowledgeNodes } from './knowledge-graph';
import type { RelationGraph } from './relation-graph';
import { relationChildren, RELATION_ROOT_ID } from './relation-view';

// 力导的初始位置：决定每一支朝哪个方向长（ADR 0126）

// 水资源四个大类的方位（度，y 向下），按数据里的顺序：上面两个有分类对应，要挨着
const PRODUCT_ANGLES = [-38, -142, 142, 38];
const PRODUCT_SPREAD = 86;
const FIRST_RADIUS = 150;
const RING_STEP = 100;
// 下级反向排列的节点：成对的节点相向，连线少交叉；国土调查把数据表排到外侧，让出对应关系的通道
const MIRRORED = new Set(['land-use/17', 'water-survey/KSQ', 'land-survey']);

/** 水资源的径向树：总节点在中心，四个大类分在四个方向，下级按叶子数分角度 */
export function waterSeeds(graph: RelationGraph): Map<string, GraphPoint> {
  const seeds = new Map<string, GraphPoint>([[RELATION_ROOT_ID, { x: 0, y: 0 }]]);
  const leaves = (id: string): number => {
    const kids = relationChildren(graph, id);
    return kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + leaves(kid), 0);
  };
  const place = (id: string, angle: number, radius: number, spread: number) => {
    const rad = (angle * Math.PI) / 180;
    seeds.set(id, { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius });
    const kids = [...relationChildren(graph, id)];
    if (MIRRORED.has(id)) {
      kids.reverse();
    }
    const total = kids.reduce((sum, kid) => sum + leaves(kid), 0);
    let start = angle - spread / 2;
    for (const kid of kids) {
      const share = (leaves(kid) / total) * spread;
      place(kid, start + share / 2, radius + RING_STEP, share);
      start += share;
    }
  };
  graph.products.forEach((product, index) => {
    place(product.id, PRODUCT_ANGLES[index % PRODUCT_ANGLES.length], FIRST_RADIUS, PRODUCT_SPREAD);
  });
  return seeds;
}

// 其他资源的初始位置：旧页面的两个扇形，参数照搬，按比例缩小。[体系, 圆心 x, 半径, 起止角度]
const SYSTEM_FANS = [
  ['survey', -390, 340, 112, 248],
  ['planning', 390, 360, -68, 68]
] as const;
// 下级节点每圈最多 7 个，第一圈半径 170，往外每圈加 96
const RING_SIZE = 7;
const RING_RADIUS = 170;
const LEGACY_RING_STEP = 96;
const LEGACY_SHRINK = 0.62;

let legacyCache: ReadonlyMap<string, GraphPoint> | null = null;

/** 其他资源的初始位置：完整分类树排出的扇形，所有检索共用 */
export function legacySeeds(): ReadonlyMap<string, GraphPoint> {
  if (legacyCache) {
    return legacyCache;
  }
  const seeds = new Map<string, GraphPoint>([['root', { x: 0, y: 0 }]]);
  for (const [system, centerX, radius, start, end] of SYSTEM_FANS) {
    seeds.set(system, { x: centerX, y: 0 });
    const categories = childrenOf(system);
    const step = categories.length === 1 ? 0 : (end - start) / (categories.length - 1);
    categories.forEach((node, index) => {
      const degree = categories.length === 1 ? (start + end) / 2 : start + step * index;
      const angle = (degree * Math.PI) / 180;
      seeds.set(node.id, { x: centerX + Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
  }
  // 下级节点朝体系外侧展开；一个父节点的子级多时分几圈
  for (const node of knowledgeNodes) {
    if (node.level === null) {
      continue;
    }
    const children = childrenOf(node.id);
    const parent = seeds.get(node.id) ?? { x: 0, y: 0 };
    const system = seeds.get(node.system === 'planning' ? 'planning' : 'survey') ?? { x: 0, y: 0 };
    const base = Math.atan2(parent.y - system.y, parent.x - system.x);
    const fan = Math.min(Math.PI * 1.18, Math.max(Math.PI / 2.2, children.length * 0.24));
    children.forEach((child, index) => {
      const ring = Math.floor(index / RING_SIZE);
      const count = Math.min(RING_SIZE, children.length - ring * RING_SIZE);
      const angle = count === 1 ? base : base - fan / 2 + (fan * (index % RING_SIZE)) / (count - 1);
      const radius = RING_RADIUS + ring * LEGACY_RING_STEP;
      seeds.set(child.id, { x: parent.x + Math.cos(angle) * radius, y: parent.y + Math.sin(angle) * radius });
    });
  }
  legacyCache = new Map([...seeds].map(([id, point]) => [id, { x: point.x * LEGACY_SHRINK, y: point.y * LEGACY_SHRINK }]));
  return legacyCache;
}
