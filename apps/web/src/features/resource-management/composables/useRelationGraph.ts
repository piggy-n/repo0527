import { computed, ref, shallowRef } from 'vue';
import type { GraphEdgeKind } from '../extraction/graph-model';
import { waterSeeds } from '../extraction/graph-seeds';
import { WATER_LEGEND } from '../extraction/graph-style';
import { RELATION_KINDS, type RelationGraph } from '../extraction/relation-graph';
import {
  buildRelationView,
  relationAncestors,
  relationNodeDetail
} from '../extraction/relation-view';
import type { KnowledgeGraphOwner } from './knowledge-graph-owner';

const EDGE_KINDS: readonly GraphEdgeKind[] = ['organize', 'contains', ...RELATION_KINDS];
// 对应关系把两端拉近的力度：成对的节点已经按初始位置相向，太强会把两组揉在一起
const MAPPING_STRENGTH = 0.07;

/**
 * 水资源图谱的拥有者：检索词、隐藏的数据成果、显示的关系类型、收起的节点和选中的节点；
 * 图和详情由纯函数从这些状态推导，组件只显示和调用
 */
export function useRelationGraph(graph: RelationGraph) {
  const keyword = ref('');
  const hiddenProducts = shallowRef<ReadonlySet<string>>(new Set());
  const kinds = shallowRef<ReadonlySet<GraphEdgeKind>>(new Set(EDGE_KINDS));
  const collapsed = shallowRef<ReadonlySet<string>>(new Set());
  const selectedId = ref<string | null>(null);

  const view = computed(() =>
    buildRelationView(graph, {
      keyword: keyword.value,
      hiddenProducts: hiddenProducts.value,
      kinds: kinds.value,
      collapsed: collapsed.value
    })
  );
  // 位置按全部节点算一次，筛选、检索、收起时不重算，节点不跳动
  const layoutInput = computed(() => {
    const { nodes, edges } = buildRelationView(graph, {
      keyword: '',
      hiddenProducts: new Set(),
      kinds: new Set(EDGE_KINDS),
      collapsed: new Set()
    });
    return { key: 'water', nodes, edges, seeds: waterSeeds(graph), mappingStrength: MAPPING_STRENGTH };
  });
  const availableKinds = new Set<GraphEdgeKind>(['organize', 'contains', ...graph.relations.map(item => item.kind)]);
  const legendEdges = computed(() =>
    EDGE_KINDS.map(kind => {
      const available = availableKinds.has(kind);
      return {
        kind,
        count: view.value.counts[kind] ?? 0,
        available,
        shown: available && kinds.value.has(kind),
        toggleable: available && kind !== 'organize' && kind !== 'contains'
      };
    })
  );
  // 总节点和大类只是组织节点，不在 graph.nodes 里，不作为取数节点
  const selected = computed(() => (selectedId.value === null ? null : (graph.nodes.get(selectedId.value) ?? null)));
  const detail = computed(() => (selectedId.value === null ? null : relationNodeDetail(graph, selectedId.value)));

  /** 换一次检索：筛选、收起和选中都回到默认 */
  function reset(text = '') {
    keyword.value = text.trim();
    hiddenProducts.value = new Set();
    kinds.value = new Set(EDGE_KINDS);
    collapsed.value = new Set();
    selectedId.value = null;
  }

  function select(id: string) {
    selectedId.value = id;
  }

  function clearSelection() {
    selectedId.value = null;
  }

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed.value);
    if (!next.delete(id)) {
      next.add(id);
    }
    collapsed.value = next;
  }

  function toggleProduct(id: string) {
    if (!graph.products.some(product => product.id === id)) {
      throw new Error(`关系图里没有数据成果 ${id}`);
    }
    const next = new Set(hiddenProducts.value);
    if (!next.delete(id)) {
      next.add(id);
    }
    hiddenProducts.value = next;
  }

  function toggleKind(kind: GraphEdgeKind) {
    const next = new Set(kinds.value);
    if (!next.delete(kind)) {
      next.add(kind);
    }
    kinds.value = next;
  }

  function clearKeyword() {
    keyword.value = '';
  }

  /** 定位到节点并选中：不在检索范围里就清掉检索，所在的数据成果隐藏时显示出来，收起的上级展开 */
  function locate(id: string) {
    if (!view.value.scope.has(id)) {
      keyword.value = '';
    }
    const ancestors = relationAncestors(graph, id);
    const hiddenOwner = [...ancestors, id].find(candidate => hiddenProducts.value.has(candidate));
    if (hiddenOwner) {
      toggleProduct(hiddenOwner);
    }
    if (ancestors.some(ancestor => collapsed.value.has(ancestor))) {
      const next = new Set(collapsed.value);
      ancestors.forEach(ancestor => next.delete(ancestor));
      collapsed.value = next;
    }
    selectedId.value = id;
  }

  return {
    title: '水资源知识图谱',
    legendNodes: WATER_LEGEND,
    graph,
    keyword,
    hiddenProducts,
    kinds,
    collapsed,
    selectedId,
    view,
    layoutInput,
    legendEdges,
    selected,
    detail,
    reset,
    select,
    clearSelection,
    locate,
    toggleCollapsed,
    toggleProduct,
    toggleKind,
    clearKeyword
  } satisfies KnowledgeGraphOwner & Record<string, unknown>;
}

export type RelationGraphOwner = ReturnType<typeof useRelationGraph>;
