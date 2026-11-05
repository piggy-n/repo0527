import { computed, ref, shallowRef } from 'vue';
import type { GraphEdgeKind } from '../extraction/graph-model';
import { legacySeeds } from '../extraction/graph-seeds';
import { KNOWLEDGE_LEGEND } from '../extraction/graph-style';
import {
  type KnowledgeNode,
  requiredNode,
  searchContext,
  searchKnowledgeNodes
} from '../extraction/knowledge-graph';
import { buildLegacyView, DENSE_NODES, initialCollapsed, legacyNodeDetail } from '../extraction/legacy-view';
import type { KnowledgeGraphOwner } from './knowledge-graph-owner';

const LEGACY_KINDS: readonly GraphEdgeKind[] = ['contains', 'class-mapping'];
const NOTHING_COLLAPSED: ReadonlySet<string> = new Set();
// 留给关系名称的空隙：比水资源图紧一点，节点数相近时范围小一些
const LEGACY_GAP = 36;

/**
 * 其他资源的图谱拥有者：检索词、收起的节点、显示的关系类型和选中的节点；
 * 图和详情由纯函数从这些状态推导，组件只显示和调用
 */
export function useLegacyGraph() {
  const keyword = ref('');
  const matches = shallowRef<readonly KnowledgeNode[]>([]);
  const collapsed = shallowRef<ReadonlySet<string>>(new Set());
  const kinds = shallowRef<ReadonlySet<GraphEdgeKind>>(new Set(LEGACY_KINDS));
  const selectedId = ref<string | null>(null);

  const context = computed(() => searchContext(matches.value));
  const viewOf = (folded: ReadonlySet<string>, shown: ReadonlySet<GraphEdgeKind>) =>
    buildLegacyView({
      keyword: keyword.value,
      context: context.value,
      matches: matches.value,
      collapsed: folded,
      kinds: shown
    });
  const view = computed(() => viewOf(collapsed.value, kinds.value));
  // 小图按检索词算一次位置，收起时节点不跳动；大图展开、收起后节点差得多，按可见的节点重算
  const layoutInput = computed(() => {
    const dense = context.value.nodes.length > DENSE_NODES;
    const folded = dense ? collapsed.value : NOTHING_COLLAPSED;
    const { nodes, edges } = viewOf(folded, new Set(LEGACY_KINDS));
    const suffix = dense ? `:${[...folded].toSorted().join()}` : '';
    return { key: `legacy:${keyword.value}${suffix}`, nodes, edges, seeds: legacySeeds(), gap: LEGACY_GAP };
  });
  const legendEdges = computed(() =>
    LEGACY_KINDS.map(kind => ({
      kind,
      count: view.value.counts[kind] ?? 0,
      available: true,
      shown: kinds.value.has(kind),
      toggleable: kind !== 'contains'
    }))
  );
  const selected = computed(() => (selectedId.value === null ? null : requiredNode(selectedId.value)));
  const detail = computed(() => (selectedId.value === null ? null : legacyNodeDetail(context.value, selectedId.value)));

  /** 换一次检索：收起、关系类型和选中都回到默认 */
  function enter(text: string) {
    keyword.value = text;
    matches.value = searchKnowledgeNodes(text);
    collapsed.value = initialCollapsed(context.value);
    kinds.value = new Set(LEGACY_KINDS);
    selectedId.value = null;
  }

  function select(id: string) {
    selectedId.value = requiredNode(id).id;
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

  function toggleKind(kind: GraphEdgeKind) {
    const next = new Set(kinds.value);
    if (!next.delete(kind)) {
      next.add(kind);
    }
    kinds.value = next;
  }

  /** 定位到节点并选中：收起的上级展开 */
  function locate(id: string) {
    const next = new Set(collapsed.value);
    for (let parent = requiredNode(id).parentId; parent !== null; parent = requiredNode(parent).parentId) {
      next.delete(parent);
    }
    if (next.size !== collapsed.value.size) {
      collapsed.value = next;
    }
    selectedId.value = id;
  }

  return {
    title: '知识图谱',
    legendNodes: KNOWLEDGE_LEGEND,
    keyword,
    collapsed,
    kinds,
    selectedId,
    view,
    layoutInput,
    legendEdges,
    selected,
    detail,
    enter,
    select,
    clearSelection,
    locate,
    toggleCollapsed,
    toggleKind
  } satisfies KnowledgeGraphOwner & Record<string, unknown>;
}

export type LegacyGraphOwner = ReturnType<typeof useLegacyGraph>;
