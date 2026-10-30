import { computed, ref, shallowRef } from 'vue';
import {
  ancestorsOf,
  RELATION_KINDS,
  type RelationGraph,
  type RelationKind,
  relationNode
} from '../extraction/relation-graph';
import { buildRelationView, relationNodeDetail } from '../extraction/relation-view';

/**
 * 关系图的拥有者：检索词、隐藏的数据成果、显示的关系类型、展开记录和选中的节点；
 * 图和详情由纯函数从这些状态推导，组件只显示和调用
 */
export function useRelationGraph(graph: RelationGraph) {
  const keyword = ref('');
  const hiddenProducts = shallowRef<ReadonlySet<string>>(new Set());
  const kinds = shallowRef<ReadonlySet<RelationKind>>(new Set(RELATION_KINDS));
  const expanded = shallowRef<ReadonlyMap<string, boolean>>(new Map());
  const selectedId = ref<string | null>(null);

  const view = computed(() =>
    buildRelationView(graph, {
      keyword: keyword.value,
      hiddenProducts: hiddenProducts.value,
      kinds: kinds.value,
      expanded: expanded.value
    })
  );
  const selected = computed(() => (selectedId.value === null ? null : relationNode(graph, selectedId.value)));
  const detail = computed(() => (selectedId.value === null ? null : relationNodeDetail(graph, selectedId.value)));

  /** 换一次检索：筛选、展开和选中都回到默认 */
  function reset(text = '') {
    keyword.value = text.trim();
    hiddenProducts.value = new Set();
    kinds.value = new Set(RELATION_KINDS);
    expanded.value = new Map();
    selectedId.value = null;
  }

  function select(id: string) {
    selectedId.value = relationNode(graph, id).id;
  }

  function clearSelection() {
    selectedId.value = null;
  }

  function toggleExpanded(id: string) {
    expanded.value = new Map(expanded.value).set(id, !(expanded.value.get(id) ?? true));
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

  function toggleKind(kind: RelationKind) {
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
    const node = relationNode(graph, id);
    if (!view.value.scope.has(id)) {
      keyword.value = '';
    }
    if (hiddenProducts.value.has(node.productId)) {
      toggleProduct(node.productId);
    }
    const ancestors = ancestorsOf(graph, id);
    if (ancestors.some(ancestor => expanded.value.get(ancestor) === false)) {
      const next = new Map(expanded.value);
      ancestors.forEach(ancestor => next.delete(ancestor));
      expanded.value = next;
    }
    selectedId.value = id;
  }

  return {
    graph,
    keyword,
    hiddenProducts,
    kinds,
    selectedId,
    view,
    selected,
    detail,
    reset,
    select,
    clearSelection,
    toggleExpanded,
    toggleProduct,
    toggleKind,
    clearKeyword,
    locate
  };
}

export type RelationGraphOwner = ReturnType<typeof useRelationGraph>;
