import type { DetailChildRelation, DetailNode, GraphEdge, GraphEdgeKind, GraphNode, GraphNodeDetail, GraphView } from './graph-model';
import { classCategory, EDGE_STYLES, NODE_STYLES, searchTitle } from './graph-style';
import {
  ancestorsOf,
  childrenOf,
  otherEnd,
  type RelationGraph,
  relationNode,
  type RelationNode,
  type RelationProduct,
  relationsOf,
  searchRelationNodes
} from './relation-graph';

/** 图上的总节点；大类的节点编号就是数据成果的编号。它们只是组织节点，不在 graph.nodes 里（ADR 0126） */
export const RELATION_ROOT_ID = 'root';

const LEVEL_NAMES = ['一级类', '二级类', '三级类'];

export interface RelationViewState {
  keyword: string;
  hiddenProducts: ReadonlySet<string>;
  kinds: ReadonlySet<GraphEdgeKind>;
  /** 收起的节点 */
  collapsed: ReadonlySet<string>;
}

export interface RelationView extends GraphView {
  /** 当前范围：有命中时是命中节点周围，否则是全部节点 */
  scope: ReadonlySet<string>;
}

function productOf(graph: RelationGraph, id: string): RelationProduct | undefined {
  return graph.products.find(product => product.id === id);
}

/** 图上的下级：总节点 → 大类 → 一级类和数据表 → 下级分类 */
export function relationChildren(graph: RelationGraph, id: string): readonly string[] {
  if (id === RELATION_ROOT_ID) {
    return graph.products.map(product => product.id);
  }
  if (productOf(graph, id)) {
    return [...graph.nodes.values()]
      .filter(node => node.productId === id && node.parentId === null)
      .map(node => node.id);
  }
  return childrenOf(graph, id);
}

/** 图上的上级，从总节点到直接上级 */
export function relationAncestors(graph: RelationGraph, id: string): string[] {
  if (id === RELATION_ROOT_ID) {
    return [];
  }
  if (productOf(graph, id)) {
    return [RELATION_ROOT_ID];
  }
  return [RELATION_ROOT_ID, relationNode(graph, id).productId, ...ancestorsOf(graph, id)];
}

/** 检索结果周围的范围：命中节点、它的上级和直接下级，以及和它有关系的节点和它们的上级；总节点和大类跟着上级带上 */
function searchScope(graph: RelationGraph, matches: readonly RelationNode[]): Set<string> {
  const ids = new Set<string>();
  const addWithAncestors = (id: string) => {
    ids.add(id);
    relationAncestors(graph, id).forEach(ancestor => ids.add(ancestor));
  };
  for (const node of matches) {
    addWithAncestors(node.id);
    childrenOf(graph, node.id).forEach(child => ids.add(child));
    relationsOf(graph, node.id).forEach(relation => addWithAncestors(otherEnd(relation, node.id)));
  }
  return ids;
}

function allIds(graph: RelationGraph): Set<string> {
  return new Set([RELATION_ROOT_ID, ...graph.products.map(product => product.id), ...graph.nodes.keys()]);
}

/**
 * 当前状态下的图：总节点连四个大类，下面是分类树和数据表；
 * 关系的一端被收起时挂到最近的可见分类上，两端落在同一节点的不画，同一对节点合成一条；一端不在检索范围里的不画
 */
export function buildRelationView(graph: RelationGraph, state: RelationViewState): RelationView {
  const matchNodes = searchRelationNodes(graph, state.keyword);
  const scope = matchNodes.length > 0 ? searchScope(graph, matchNodes) : allIds(graph);
  const matches = new Set(matchNodes.map(node => node.id));

  const visible = new Set<string>();
  const walk = (id: string) => {
    if (!scope.has(id) || state.hiddenProducts.has(id)) {
      return;
    }
    visible.add(id);
    if (!state.collapsed.has(id)) {
      relationChildren(graph, id).forEach(walk);
    }
  };
  walk(RELATION_ROOT_ID);

  const rootName = matchNodes.length > 0 ? searchTitle(state.keyword.trim()) : graph.title;
  const nodes: GraphNode[] = [];
  for (const id of visible) {
    const childCount = relationChildren(graph, id).filter(child => scope.has(child)).length;
    nodes.push({
      id,
      match: matches.has(id),
      childCount,
      hiddenChildren: state.collapsed.has(id) ? childCount : 0,
      ...nodeShape(graph, id, rootName)
    });
  }

  const edges: GraphEdge[] = [];
  for (const id of visible) {
    for (const child of relationChildren(graph, id)) {
      if (visible.has(child)) {
        edges.push(treeEdge(graph, id, child));
      }
    }
  }
  const counts: Partial<Record<GraphEdgeKind, number>> = { 'class-mapping': 0, temporal: 0, 'field-mapping': 0, spatial: 0 };
  const merged = new Map<string, GraphEdge>();
  const nearestVisible = (id: string) => [...ancestorsOf(graph, id), id].findLast(candidate => visible.has(candidate));
  for (const relation of graph.relations) {
    const a = nearestVisible(relation.source);
    const b = nearestVisible(relation.target);
    if (!scope.has(relation.source) || !scope.has(relation.target) || !a || !b) {
      continue;
    }
    counts[relation.kind] = (counts[relation.kind] ?? 0) + 1;
    if (a === b || !state.kinds.has(relation.kind)) {
      continue;
    }
    const id = `${relation.kind}|${a}|${b}`;
    const count = (merged.get(id)?.count ?? 0) + 1;
    const name = EDGE_STYLES[relation.kind].label;
    const label = count > 1 ? `${name} ×${count}` : name;
    merged.set(id, { id, source: a, target: b, kind: relation.kind, label, depth: 0, count });
  }
  edges.push(...merged.values());
  counts.organize = edges.filter(edge => edge.kind === 'organize').length;
  counts.contains = edges.filter(edge => edge.kind === 'contains').length;
  return { nodes, edges, matches, counts, scope };
}

// 节点里和状态无关的部分
function nodeShape(graph: RelationGraph, id: string, rootName: string): Pick<GraphNode, 'name' | 'code' | 'kind' | 'level' | 'category'> {
  if (id === RELATION_ROOT_ID) {
    return { name: rootName, code: '', kind: 'root', level: null, category: 'root' };
  }
  const product = productOf(graph, id);
  if (product) {
    return { name: product.name, code: '', kind: 'system', level: null, category: 'system' };
  }
  const node = relationNode(graph, id);
  return node.level === null
    ? { name: node.name, code: node.code, kind: 'dataset', level: null, category: 'dataset' }
    : { name: node.name, code: node.code, kind: 'class', level: node.level, category: classCategory(node.productId, node.level) };
}

function treeEdge(graph: RelationGraph, parent: string, child: string): GraphEdge {
  const id = `tree:${child}`;
  if (parent === RELATION_ROOT_ID) {
    const label = productOf(graph, child)?.relation ?? '';
    return { id, source: parent, target: child, kind: 'organize', label, depth: 0, count: 1 };
  }
  const node = relationNode(graph, child);
  const label = node.level === null ? '数据表' : EDGE_STYLES.contains.label;
  const depth = ancestorsOf(graph, child).length + 1;
  return { id, source: parent, target: child, kind: 'contains', label, depth, count: 1 };
}

function detailNode(node: RelationNode): DetailNode {
  return { id: node.id, code: node.code, name: node.name };
}

function organizeNode(graph: RelationGraph, id: string): DetailNode {
  const name = id === RELATION_ROOT_ID ? graph.title : (productOf(graph, id)?.name ?? id);
  return { id, code: '', name };
}

function anyDetailNode(graph: RelationGraph, id: string): DetailNode {
  const node = graph.nodes.get(id);
  return node ? detailNode(node) : organizeNode(graph, id);
}

// 下级和子树以外节点的关系
function childRelationsOf(graph: RelationGraph, id: string): DetailChildRelation[] {
  const inside = (candidate: string) => candidate !== id && relationAncestors(graph, candidate).includes(id);
  return graph.relations.flatMap(relation => {
    const sourceInside = inside(relation.source);
    if (sourceInside === inside(relation.target)) {
      return [];
    }
    const [innerId, otherId] = sourceInside ? [relation.source, relation.target] : [relation.target, relation.source];
    return [
      {
        id: relation.id,
        kind: relation.kind,
        label: EDGE_STYLES[relation.kind].label,
        inner: detailNode(relationNode(graph, innerId)),
        other: detailNode(relationNode(graph, otherId))
      }
    ];
  });
}

const NO_DETAIL = { path: [], relations: [], childRelations: [], table: null, datasets: [], datasetsTitle: '', note: '' };

/** 选中节点的详情；总节点和大类可以看，但不是取数节点 */
export function relationNodeDetail(graph: RelationGraph, id: string): GraphNodeDetail {
  const children = relationChildren(graph, id).map(child => anyDetailNode(graph, child));
  if (id === RELATION_ROOT_ID) {
    return {
      ...NO_DETAIL,
      id,
      code: '',
      name: graph.title,
      meta: NODE_STYLES.root.label,
      color: NODE_STYLES.root.fill,
      isTarget: false,
      children,
      relations: graph.products.map(product => ({
        id: `organize:${product.id}`,
        kind: 'organize',
        label: product.relation,
        other: organizeNode(graph, product.id)
      })),
      note: '总节点和它的关系只用于组织展示，不改变四个大类原有的数据关系'
    };
  }
  const product = productOf(graph, id);
  if (product) {
    return {
      ...NO_DETAIL,
      id,
      code: '',
      name: product.name,
      meta: `${NODE_STYLES.system.label} · ${product.kind}`,
      color: NODE_STYLES.system.fill,
      isTarget: false,
      children,
      relations: [
        {
          id: `organize:${id}`,
          kind: 'organize',
          label: product.relation,
          other: organizeNode(graph, RELATION_ROOT_ID)
        }
      ],
      childRelations: childRelationsOf(graph, id)
    };
  }
  const node = relationNode(graph, id);
  const owner = productOf(graph, node.productId);
  const levelName = node.level === null ? NODE_STYLES.dataset.label : (LEVEL_NAMES[node.level - 1] ?? `${node.level} 级类`);
  const category = node.level === null ? 'dataset' : classCategory(node.productId, node.level);
  const datasets = node.level === null
    ? []
    : [...graph.nodes.values()].filter(item => item.productId === node.productId && item.level === null).map(detailNode);
  return {
    id,
    code: node.code,
    name: node.name,
    meta: [owner?.name, levelName].filter(Boolean).join(' · '),
    color: NODE_STYLES[category].fill,
    isTarget: true,
    path: ancestorsOf(graph, id).map(ancestor => detailNode(relationNode(graph, ancestor))),
    relations: relationsOf(graph, id).map(relation => {
      const other = relationNode(graph, otherEnd(relation, id));
      return {
        id: relation.id,
        kind: relation.kind,
        label: EDGE_STYLES[relation.kind].label,
        other: detailNode(other),
        product: productOf(graph, other.productId)?.name
      };
    }),
    childRelations: childRelationsOf(graph, id),
    children,
    table: node.table,
    datasets,
    datasetsTitle: `${owner?.name ?? ''}的数据表`,
    note: ''
  };
}
