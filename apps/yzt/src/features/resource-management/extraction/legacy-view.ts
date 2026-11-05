import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeDetail, GraphView } from './graph-model';
import { EDGE_STYLES, knowledgeCategory, NODE_STYLES, searchTitle } from './graph-style';
import { type KnowledgeGraph, type KnowledgeNode, requiredNode } from './knowledge-graph';

// 其他资源的知识图谱：子图规则不变（knowledge-graph.ts），转成和水资源图一样的"图"（ADR 0126）

/** 超过这么多节点时放不下全部名称：先收起到一级类，双击展开 */
export const DENSE_NODES = 60;

export interface LegacyViewState {
  keyword: string;
  context: KnowledgeGraph;
  matches: readonly KnowledgeNode[];
  collapsed: ReadonlySet<string>;
  kinds: ReadonlySet<GraphEdgeKind>;
}

function childCounts(context: KnowledgeGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of context.nodes) {
    if (node.parentId !== null) {
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    }
  }
  return counts;
}

/** 这次检索默认收起哪些节点：小图都展开，大图收起到一级类 */
export function initialCollapsed(context: KnowledgeGraph): Set<string> {
  if (context.nodes.length <= DENSE_NODES) {
    return new Set();
  }
  const counts = childCounts(context);
  return new Set(context.nodes.filter(node => node.level === 1 && counts.has(node.id)).map(node => node.id));
}

function depthOf(node: KnowledgeNode): number {
  let depth = 0;
  for (let parent = node.parentId; parent !== null; parent = requiredNode(parent).parentId) {
    depth += 1;
  }
  return depth;
}

function nodeKind(node: KnowledgeNode): GraphNode['kind'] {
  if (node.type === 'root' || node.type === 'system') {
    return node.type;
  }
  return 'class';
}

/** 当前状态下的图：根节点的名称带上检索词，被收起的下级不画 */
export function buildLegacyView(state: LegacyViewState): GraphView {
  const counts = childCounts(state.context);
  const matches = new Set(state.matches.map(node => node.id));
  const hidden = (node: KnowledgeNode) => {
    for (let parent = node.parentId; parent !== null; parent = requiredNode(parent).parentId) {
      if (state.collapsed.has(parent)) {
        return true;
      }
    }
    return false;
  };
  const shown = state.context.nodes.filter(node => !hidden(node));
  const visible = new Set(shown.map(node => node.id));
  const nodes = shown.map((node): GraphNode => {
    const childCount = counts.get(node.id) ?? 0;
    return {
      id: node.id,
      name: node.type === 'root' ? searchTitle(state.keyword) : node.displayName,
      code: node.code,
      kind: nodeKind(node),
      level: node.level,
      category: knowledgeCategory(node),
      match: matches.has(node.id),
      childCount,
      hiddenChildren: state.collapsed.has(node.id) ? childCount : 0
    };
  });
  const allEdges = state.context.edges
    .filter(edge => visible.has(edge.source) && visible.has(edge.target))
    .map((edge): GraphEdge => {
      if (edge.type === 'mapping') {
        const label = EDGE_STYLES['class-mapping'].label;
        return { id: edge.id, source: edge.source, target: edge.target, kind: 'class-mapping', label, depth: 0, count: 1 };
      }
      // 根节点到分类体系沿用旧项目的叫法
      const label = edge.source === 'root' ? '分类体系' : EDGE_STYLES.contains.label;
      const depth = depthOf(requiredNode(edge.target)) - 1;
      return { id: edge.id, source: edge.source, target: edge.target, kind: 'contains', label, depth, count: 1 };
    });
  return {
    nodes,
    edges: allEdges.filter(edge => state.kinds.has(edge.kind)),
    matches,
    counts: {
      contains: allEdges.filter(edge => edge.kind === 'contains').length,
      'class-mapping': allEdges.filter(edge => edge.kind === 'class-mapping').length
    }
  };
}

const detailNode = (node: KnowledgeNode) => ({ id: node.id, code: node.code, name: node.displayName });

/** 选中节点的详情：只列这张图里有的节点，点了都能定位过去 */
export function legacyNodeDetail(context: KnowledgeGraph, id: string): GraphNodeDetail {
  const node = requiredNode(id);
  const inContext = new Set(context.nodes.map(item => item.id));
  const path = [];
  for (let parent = node.parentId; parent !== null; parent = requiredNode(parent).parentId) {
    const item = requiredNode(parent);
    if (item.level !== null) {
      path.unshift(detailNode(item));
    }
  }
  return {
    id,
    code: node.code,
    name: node.displayName,
    meta: [node.systemName, node.levelName].filter(Boolean).join(' · '),
    color: NODE_STYLES[knowledgeCategory(node)].fill,
    isTarget: true,
    path,
    relations: context.edges.flatMap(edge => {
      if (edge.type !== 'mapping' || (edge.source !== id && edge.target !== id)) {
        return [];
      }
      const other = requiredNode(edge.source === id ? edge.target : edge.source);
      return [{ id: edge.id, kind: 'class-mapping' as const, label: EDGE_STYLES['class-mapping'].label, other: detailNode(other) }];
    }),
    childRelations: [],
    children: context.nodes.filter(item => item.parentId === id && inContext.has(item.id)).map(detailNode),
    table: null,
    datasets: [],
    datasetsTitle: '',
    note: ''
  };
}
