import {
  ancestorsOf,
  childrenOf,
  type GraphRelation,
  otherEnd,
  type RelationGraph,
  type RelationKind,
  relationNode,
  type RelationNode,
  type RelationProduct,
  relationsOf,
  searchRelationNodes
} from './relation-graph';

export interface RelationViewState {
  keyword: string;
  hiddenProducts: ReadonlySet<string>;
  kinds: ReadonlySet<RelationKind>;
  /** 展开、收起过的节点；没有记录的默认展开 */
  expanded: ReadonlyMap<string, boolean>;
}

export interface RelationTreeItem {
  node: RelationNode;
  open: boolean;
  /** 当前范围里的下级个数，收起时也算 */
  childCount: number;
  children: RelationTreeItem[];
}

export interface RelationLane {
  product: RelationProduct;
  /** 数据成果在整份数据里的序号，决定泳道颜色 */
  productIndex: number;
  tree: RelationTreeItem[];
  datasets: RelationNode[];
  classCount: number;
}

/** 图上的一条线：两端都是可见节点，同一对节点、同一种关系合成一条 */
export interface RelationEdge {
  key: string;
  kind: RelationKind;
  from: string;
  to: string;
  relations: GraphRelation[];
}

export interface RelationView {
  lanes: RelationLane[];
  edges: RelationEdge[];
  /** 检索命中的节点 */
  matches: ReadonlySet<string>;
  /** 当前范围：有命中时是命中节点周围，否则是全部节点 */
  scope: ReadonlySet<string>;
  /** 可见节点所在的泳道 */
  laneOf: ReadonlyMap<string, number>;
  /** 范围里的节点在图上由谁代表：自己可见就是自己，被收起时是最近的可见上级 */
  representatives: ReadonlyMap<string, string>;
  /** 每种关系在可见泳道之间的条数，不论是否显示 */
  counts: Readonly<Record<RelationKind, number>>;
}

/** 检索结果周围的范围：命中节点、它的上级和直接下级，以及和它有关系的节点和它们的上级 */
function searchScope(graph: RelationGraph, matches: readonly RelationNode[]): Set<string> {
  const ids = new Set<string>();
  const addWithAncestors = (id: string) => {
    ids.add(id);
    ancestorsOf(graph, id).forEach(ancestor => ids.add(ancestor));
  };
  for (const node of matches) {
    addWithAncestors(node.id);
    childrenOf(graph, node.id).forEach(child => ids.add(child));
    relationsOf(graph, node.id).forEach(relation => addWithAncestors(otherEnd(relation, node.id)));
  }
  return ids;
}

/**
 * 当前状态下的图：每个数据成果一条泳道，分类按层级排成树，数据表在泳道底部；
 * 关系的一端被收起时挂到最近的可见上级上，两端落在同一节点的关系不画
 */
export function buildRelationView(graph: RelationGraph, state: RelationViewState): RelationView {
  const matchNodes = searchRelationNodes(graph, state.keyword);
  const scope = matchNodes.length > 0 ? searchScope(graph, matchNodes) : new Set(graph.nodes.keys());
  const isOpen = (id: string) => state.expanded.get(id) ?? true;

  const lanes: RelationLane[] = [];
  const laneOf = new Map<string, number>();
  graph.products.forEach((product, productIndex) => {
    if (state.hiddenProducts.has(product.id)) {
      return;
    }
    const lane = lanes.length;
    const toItem = (node: RelationNode): RelationTreeItem => {
      laneOf.set(node.id, lane);
      const kids = childrenOf(graph, node.id).filter(id => scope.has(id));
      const open = kids.length > 0 && isOpen(node.id);
      return {
        node,
        open,
        childCount: kids.length,
        children: open ? kids.map(id => toItem(relationNode(graph, id))) : []
      };
    };
    const nodes = [...graph.nodes.values()].filter(node => node.productId === product.id && scope.has(node.id));
    const tree = nodes.filter(node => node.level === 1).map(toItem);
    const datasets = nodes.filter(node => node.level === null);
    datasets.forEach(node => laneOf.set(node.id, lane));
    if (tree.length > 0 || datasets.length > 0) {
      lanes.push({ product, productIndex, tree, datasets, classCount: nodes.length - datasets.length });
    }
  });

  // 可见的节点都在 laneOf 里（收起的下级没有展开过）；代表是自己和上级里最深的可见节点
  const representatives = new Map<string, string>();
  for (const id of scope) {
    const nearest = [...ancestorsOf(graph, id), id].findLast(candidate => laneOf.has(candidate));
    if (nearest) {
      representatives.set(id, nearest);
    }
  }

  const order = new Map([...graph.nodes.keys()].map((id, index) => [id, index]));
  const position = (id: string) => [laneOf.get(id) ?? 0, order.get(id) ?? 0];
  const counts: Record<RelationKind, number> = { 'class-mapping': 0, temporal: 0, 'field-mapping': 0, spatial: 0 };
  const edges = new Map<string, RelationEdge>();
  for (const relation of graph.relations) {
    const a = representatives.get(relation.source);
    const b = representatives.get(relation.target);
    if (!a || !b) {
      continue;
    }
    counts[relation.kind] += 1;
    if (a === b || !state.kinds.has(relation.kind)) {
      continue;
    }
    const [from, to] = [a, b].toSorted((x, y) => {
      const [laneX, orderX] = position(x);
      const [laneY, orderY] = position(y);
      return laneX - laneY || orderX - orderY;
    });
    const key = `${relation.kind}|${from}|${to}`;
    const edge = edges.get(key) ?? { key, kind: relation.kind, from, to, relations: [] };
    edge.relations.push(relation);
    edges.set(key, edge);
  }

  return {
    lanes,
    edges: [...edges.values()],
    matches: new Set(matchNodes.map(node => node.id)),
    scope,
    laneOf,
    representatives,
    counts
  };
}

export interface RelationLink {
  relation: GraphRelation;
  other: RelationNode;
}

export interface ChildRelationLink extends RelationLink {
  /** 关系在这个节点子树里的一端 */
  inner: RelationNode;
}

export interface RelationNodeDetail {
  node: RelationNode;
  product: RelationProduct;
  /** 从一级类到直接上级 */
  path: RelationNode[];
  children: RelationNode[];
  relations: RelationLink[];
  /** 下级分类和子树以外节点的关系，收起时在详情里也能看到 */
  childRelations: ChildRelationLink[];
  /** 分类所属数据成果的数据表 */
  productDatasets: RelationNode[];
}

function isInside(graph: RelationGraph, id: string, rootId: string): boolean {
  return id === rootId || ancestorsOf(graph, id).includes(rootId);
}

/** 选中节点的详情 */
export function relationNodeDetail(graph: RelationGraph, id: string): RelationNodeDetail {
  const node = relationNode(graph, id);
  const product = graph.products.find(item => item.id === node.productId);
  if (!product) {
    throw new Error(`关系图里没有数据成果 ${node.productId}`);
  }
  const childRelations = graph.relations.flatMap(relation => {
    const ends = [relation.source, relation.target];
    const inner = ends.filter(end => end !== id && isInside(graph, end, id));
    if (inner.length !== 1 || isInside(graph, otherEnd(relation, inner[0]), id)) {
      return [];
    }
    const innerNode = relationNode(graph, inner[0]);
    return [{ relation, inner: innerNode, other: relationNode(graph, otherEnd(relation, innerNode.id)) }];
  });
  const datasets = [...graph.nodes.values()].filter(item => item.productId === node.productId && item.level === null);
  return {
    node,
    product,
    path: ancestorsOf(graph, id).map(ancestor => relationNode(graph, ancestor)),
    children: childrenOf(graph, id).map(child => relationNode(graph, child)),
    relations: relationsOf(graph, id).map(relation => ({
      relation,
      other: relationNode(graph, otherEnd(relation, id))
    })),
    childRelations,
    productDatasets: node.level === null ? [] : datasets
  };
}
