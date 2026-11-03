import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import {
  createExtractionForm,
  type ExtractionNode,
  extractionRequest,
  type ExtractionRequest,
  extractionTarget
} from '../extraction/extraction-form';
import { chooseExtractionGraph, type ExtractionGraph, waterGraph } from '../extraction/relation-graph';
import { useLegacyGraph } from './useLegacyGraph';
import { useRelationGraph } from './useRelationGraph';

/** 三步：搜索关键词、在知识图谱里选节点并填条件、完成 */
export type ExtractionStep = 'search' | 'graph' | 'done';

/**
 * 自助取数的弹窗：每次打开都从第一步和默认条件开始。旧页面的"开始取数"只是在前端切到完成页，
 * 没有接口、任务和结果文件（docs/modules/resource-management.md），这里同样只保存提交时的条件快照。
 * 第二步按检索词选图：水资源（relation）和其他资源（legacy）用同一种知识图谱，数据不同
 */
export function useDataExtraction() {
  const session = useSessionStore();
  const open = ref(false);
  const step = ref<ExtractionStep>('search');
  const keyword = ref('');
  const mode = ref<ExtractionGraph>('legacy');
  const legacy = useLegacyGraph();
  const relation = useRelationGraph(waterGraph);
  const form = reactive(createExtractionForm());
  const request = shallowRef<ExtractionRequest | null>(null);
  // 当前图里选中的节点：水资源的节点带上数据表的几何类型
  const target = computed<ExtractionNode | null>(() => {
    if (mode.value === 'legacy') {
      return legacy.selected.value;
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
    mode.value = 'legacy';
    legacy.enter('');
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

  /** 按资源类别进入：直接打开水资源图谱的全部节点 */
  function browseWater() {
    enterGraph('relation', '');
  }

  function enterGraph(choice: ExtractionGraph, text: string) {
    mode.value = choice;
    legacy.enter(choice === 'legacy' ? text : '');
    relation.reset(choice === 'relation' ? text : '');
    step.value = 'graph';
  }

  /** 回到第一步：清掉选中的节点和跟着它的数据名称、数据需求，其余条件保留 */
  function back() {
    legacy.clearSelection();
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
    mode,
    legacy,
    relation,
    form,
    request,
    start,
    close,
    search,
    browseWater,
    back,
    submit
  };
}

export type DataExtractionOwner = ReturnType<typeof useDataExtraction>;
