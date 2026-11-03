import type { ComputedRef, Ref } from 'vue';
import type { GraphEdgeKind, GraphLayoutInput, GraphNodeDetail, GraphView } from '../extraction/graph-model';
import type { NodeCategoryId } from '../extraction/graph-style';

/** 图例里的一种关系 */
export interface LegendEdge {
  kind: GraphEdgeKind;
  count: number;
  /** 有没有这种关系的数据；没有的显示"待补充" */
  available: boolean;
  shown: boolean;
  toggleable: boolean;
}

/** 水资源和其他资源的图谱拥有者共有的部分：面板和详情只通过它显示和调用 */
export interface KnowledgeGraphOwner {
  /** 画布的无障碍名称 */
  readonly title: string;
  readonly legendNodes: readonly NodeCategoryId[];
  readonly view: ComputedRef<GraphView>;
  readonly layoutInput: ComputedRef<GraphLayoutInput>;
  readonly legendEdges: ComputedRef<readonly LegendEdge[]>;
  readonly selectedId: Ref<string | null>;
  readonly detail: ComputedRef<GraphNodeDetail | null>;
  select: (id: string) => void;
  /** 定位到节点并选中：被检索、隐藏或收起挡住时先显示出来 */
  locate: (id: string) => void;
  toggleCollapsed: (id: string) => void;
  toggleKind: (kind: GraphEdgeKind) => void;
}
