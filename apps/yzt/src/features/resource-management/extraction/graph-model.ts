import type { NodeCategoryId } from './graph-style';
import type { RelationKind, RelationTable } from './relation-graph';

// 水资源和其他资源的知识图谱共用的"图"：两份数据各自转成这些节点和关系，画法、图例和详情都一样（ADR 0126）

/** 总节点、分类体系（大类）、分类、数据表 */
export type GraphNodeKind = 'root' | 'system' | 'class' | 'dataset';

/** organize 是总节点和大类的组织关系，只用于展示；contains 是上下级；其余是数据里的关系 */
export type GraphEdgeKind = 'organize' | 'contains' | RelationKind;

export interface GraphNode {
  id: string;
  /** 图上的名称 */
  name: string;
  code: string;
  kind: GraphNodeKind;
  /** 分类的层级，从 1 开始；总节点、大类和数据表为 null */
  level: number | null;
  category: NodeCategoryId;
  /** 检索命中 */
  match: boolean;
  /** 当前范围里的下级个数，收起时也算 */
  childCount: number;
  /** 收起后隐藏的下级个数 */
  hiddenChildren: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  label: string;
  /** 上下级的线在第几层，越往下越细；其他关系为 0 */
  depth: number;
  /** 合并的关系条数：被收起的一端挂到上级后，同一对节点合成一条 */
  count: number;
}

export interface GraphView {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** 检索命中的节点 */
  matches: ReadonlySet<string>;
  /** 每种关系的条数，关掉的关系类型也算 */
  counts: Readonly<Partial<Record<GraphEdgeKind, number>>>;
}

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphViewport {
  width: number;
  height: number;
}

/** 布局的输入：key 相同就复用结果（再按画布大小区分），筛选、检索、收起时节点不跳动 */
export interface GraphLayoutInput {
  key: string;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  seeds: ReadonlyMap<string, GraphPoint>;
  /** 上下级的线留给关系名称的长度 */
  gap?: number;
  /** 对应关系把两端拉近的力度 */
  mappingStrength?: number;
}

export interface DetailNode {
  id: string;
  code: string;
  name: string;
}

export interface DetailRelation {
  id: string;
  kind: GraphEdgeKind;
  label: string;
  other: DetailNode;
  /** 另一端所属的数据成果 */
  product?: string;
}

export interface DetailChildRelation {
  id: string;
  kind: GraphEdgeKind;
  label: string;
  /** 关系在这个节点子树里的一端 */
  inner: DetailNode;
  other: DetailNode;
}

/** 右侧详情的内容 */
export interface GraphNodeDetail {
  id: string;
  code: string;
  name: string;
  /** 所属体系和层级，如"国土调查分类 · 二级类" */
  meta: string;
  /** 图上这个节点的颜色 */
  color: string;
  /** 能不能作为取数节点；水资源的总节点和大类只是组织节点 */
  isTarget: boolean;
  /** 从一级类到直接上级 */
  path: readonly DetailNode[];
  relations: readonly DetailRelation[];
  /** 下级和子树以外节点的关系，收起时在详情里也能看到 */
  childRelations: readonly DetailChildRelation[];
  children: readonly DetailNode[];
  table: RelationTable | null;
  /** 所属数据成果的数据表 */
  datasets: readonly DetailNode[];
  datasetsTitle: string;
  note: string;
}
