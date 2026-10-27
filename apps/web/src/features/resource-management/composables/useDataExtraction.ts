import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import { createExtractionForm, extractionRequest, type ExtractionRequest } from '../extraction/extraction-form';
import { type KnowledgeNode, searchContext, searchKnowledgeNodes } from '../extraction/knowledge-graph';

/** 三步：搜索关键词、在关系图里选节点并填条件、完成 */
export type ExtractionStep = 'search' | 'graph' | 'done';

/**
 * 自助取数的弹窗：每次打开都从第一步和默认条件开始。旧页面的"开始取数"只是在前端切到完成页，
 * 没有接口、任务和结果文件（docs/modules/resource-management.md），这里同样只保存提交时的条件快照
 */
export function useDataExtraction() {
  const session = useSessionStore();
  const open = ref(false);
  const step = ref<ExtractionStep>('search');
  const keyword = ref('');
  // 关系图对应的关键词：进入第二步时确定，之后改输入框不影响图
  const searched = ref('');
  const matches = shallowRef<readonly KnowledgeNode[]>([]);
  const graph = computed(() => searchContext(matches.value));
  const selected = shallowRef<KnowledgeNode | null>(null);
  const form = reactive(createExtractionForm());
  const request = shallowRef<ExtractionRequest | null>(null);

  function start() {
    step.value = 'search';
    keyword.value = '';
    searched.value = '';
    matches.value = [];
    selected.value = null;
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
    const found = searchKnowledgeNodes(text);
    if (found.length === 0) {
      return '未搜索到匹配节点';
    }
    keyword.value = text;
    searched.value = text;
    matches.value = found;
    selected.value = null;
    step.value = 'graph';
    return null;
  }

  /** 选中节点只显示它的信息，不改动已填的条件 */
  function select(node: KnowledgeNode) {
    if (step.value === 'graph') {
      selected.value = node;
    }
  }

  /** 回到第一步：保留已填的条件，清掉选中的节点 */
  function back() {
    selected.value = null;
    step.value = 'search';
  }

  /** 和旧页面一样只要求至少一种数据格式；返回给用户的提示 */
  function submit(): string | null {
    if (step.value !== 'graph') {
      return null;
    }
    if (form.formats.length === 0) {
      return '请至少选择一种数据格式';
    }
    request.value = extractionRequest(form, selected.value);
    step.value = 'done';
    return null;
  }

  return { open, step, keyword, searched, graph, selected, form, request, start, close, search, select, back, submit };
}

export type DataExtractionOwner = ReturnType<typeof useDataExtraction>;
