import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import {
  createExtractionForm,
  type ExtractionNode,
  extractionRequest,
  type ExtractionRequest,
  extractionTarget
} from '../extraction/extraction-form';
import { type KnowledgeNode, searchContext, searchKnowledgeNodes } from '../extraction/knowledge-graph';
import { chooseExtractionGraph, type ExtractionGraph, waterGraph } from '../extraction/relation-graph';
import { useRelationGraph } from './useRelationGraph';

/** 三步：搜索关键词、在关系图里选节点并填条件、完成 */
export type ExtractionStep = 'search' | 'graph' | 'done';

/**
 * 自助取数的弹窗：每次打开都从第一步和默认条件开始。旧页面的"开始取数"只是在前端切到完成页，
 * 没有接口、任务和结果文件（docs/modules/resource-management.md），这里同样只保存提交时的条件快照。
 * 第二步按检索词选图：水资源用泳道关系图（relation），其他资源沿用旧版知识图谱（legacy）
 */
export function useDataExtraction() {
  const session = useSessionStore();
  const open = ref(false);
  const step = ref<ExtractionStep>('search');
  const keyword = ref('');
  // 关系图对应的关键词：进入第二步时确定，之后改输入框不影响图
  const searched = ref('');
  const mode = ref<ExtractionGraph>('legacy');
  const matches = shallowRef<readonly KnowledgeNode[]>([]);
  const graph = computed(() => searchContext(matches.value));
  const selected = shallowRef<KnowledgeNode | null>(null);
  const relation = useRelationGraph(waterGraph);
  const form = reactive(createExtractionForm());
  const request = shallowRef<ExtractionRequest | null>(null);
  // 当前图里选中的节点：关系图的节点带上数据表的几何类型
  const target = computed<ExtractionNode | null>(() => {
    if (mode.value === 'legacy') {
      return selected.value;
    }
    const node = relation.selected.value;
    return node && { id: node.id, name: node.name, geometry: node.table?.geometry };
  });

  // 数据名称和数据需求跟着选中的节点：选了节点就重新填写（之后可以改），没有选中时清空
  watch(
    target,
    node => {
      Object.assign(form, node ? extractionTarget(node) : { dataName: '', requirement: '' });
    },
    { flush: 'sync' }
  );

  function start() {
    step.value = 'search';
    keyword.value = '';
    searched.value = '';
    mode.value = 'legacy';
    matches.value = [];
    selected.value = null;
    relation.reset();
    request.value = null;
    Object.assign(form, createExtractionForm());
    open.value = true;
  }

  function close() {
    open.value = false;
  }

  watch(() => session.token, close, { flush: 'sync' });
  onScopeDispose(close);

  /** 搜索并进入第二步；没有关键词或没有结果时留在第一步，返回给用户的提示 */
  function search(value = keyword.value): string | null {
    const text = value.trim();
    if (!text) {
      return '请输入搜索关键词';
    }
    const choice = chooseExtractionGraph(text);
    if (choice === null) {
      return '未搜索到匹配节点';
    }
    keyword.value = text;
    enterGraph(choice, text);
    return null;
  }

  /** 按资源类别进入：直接打开水资源关系图的全部节点 */
  function browseWater() {
    enterGraph('relation', '');
  }

  function enterGraph(choice: ExtractionGraph, text: string) {
    searched.value = text;
    mode.value = choice;
    matches.value = choice === 'legacy' ? searchKnowledgeNodes(text) : [];
    selected.value = null;
    relation.reset(choice === 'relation' ? text : '');
    step.value = 'graph';
  }

  /** 选中节点：显示它的信息，数据名称和数据需求换成这个节点的，其余条件不变 */
  function select(node: KnowledgeNode) {
    if (step.value === 'graph') {
      selected.value = node;
    }
  }

  /** 回到第一步：清掉选中的节点和跟着它的数据名称、数据需求，其余条件保留 */
  function back() {
    selected.value = null;
    relation.clearSelection();
    step.value = 'search';
  }

  /** 数据格式至少一种；数据名称和数据需求的必填由弹窗的表单校验。返回给用户的提示 */
  function submit(): string | null {
    if (step.value !== 'graph') {
      return null;
    }
    if (form.formats.length === 0) {
      return '请至少选择一种数据格式';
    }
    request.value = extractionRequest(form, target.value);
    step.value = 'done';
    return null;
  }

  return {
    open,
    step,
    keyword,
    searched,
    mode,
    graph,
    selected,
    relation,
    form,
    request,
    start,
    close,
    search,
    browseWater,
    select,
    back,
    submit
  };
}

export type DataExtractionOwner = ReturnType<typeof useDataExtraction>;
