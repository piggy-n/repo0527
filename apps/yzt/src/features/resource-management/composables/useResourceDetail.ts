import { computed, type MaybeRefOrGetter, onScopeDispose, readonly, ref, shallowRef, toValue, watch } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { ResourceAttribute, ResourceDetail, ResourceDirectory, ResourceRecord } from '../api';
import { useResourceDetailMutation, useResourceDetailQuery } from '../queries';
import { useResourceImport } from './useResourceImport';

/** 正在查看的资源：从列表打开时的行和所在目录，标题在详情加载前就能显示 */
interface DetailTarget {
  id: string;
  name: string;
  year: number | null;
  directoryId: string;
}

interface DraftCategory {
  id: string;
  name: string;
}

/** 编辑草稿：只放可改的数据分类和字段名称，和查询缓存分开，后台刷新不覆盖输入 */
interface DetailDraft {
  // 开始编辑时的详情，用来判断有没有改动和组装保存的请求
  base: ResourceDetail;
  // 没能唯一对应到目录时为 null，要用户选择后才能保存
  category: DraftCategory | null;
  attributes: ResourceAttribute[];
  token: string | undefined;
}

// 详情只有分类名称，按名称找目录；有同名目录时优先打开时所在的目录，其他同名的不猜
function matchCategory(name: string, categories: ResourceDirectory[], directoryId: string | undefined) {
  const matches = categories.filter(node => node.name === name);
  const category = matches.find(node => node.id === directoryId) ?? (matches.length === 1 ? matches[0] : undefined);
  return category ? { id: category.id, name: category.name } : null;
}

function isDirty(draft: DetailDraft): boolean {
  const { base, category, attributes } = draft;
  return (
    (category?.name ?? base.resourceName) !== base.resourceName ||
    attributes.some((attribute, index) => attribute.name !== base.attributes[index]?.name)
  );
}

/**
 * 资源详情与编辑：读取由查询负责，保存是服务端写操作，草稿和离开前的确认在这里；不渲染、不提示。
 * 离开（返回列表、切目录、换页面）时有未保存的修改要先确认，确认框由页面显示，回答经 answerDiscard 交回
 */
export function useResourceDetail(tree: MaybeRefOrGetter<ResourceDirectory[]>) {
  const session = useSessionStore();
  const sessionGuard = useSessionGuard();
  const target = shallowRef<DetailTarget | null>(null);
  const draft = shallowRef<DetailDraft | null>(null);
  // 保存中
  const pending = ref(false);
  const error = ref('');
  // 正在等用户回答是否放弃修改
  const confirming = ref(false);
  let resolveDiscard: ((discard: boolean) => void) | undefined;
  let disposed = false;
  const query = useResourceDetailQuery(() => target.value?.id ?? null);
  const mutation = useResourceDetailMutation();
  // 换资源的当轮查询还是旧资源的结果，按 ID 核对后才显示
  const detail = computed(() => (query.data.value?.id === target.value?.id ? query.data.value?.detail : undefined));
  // 数据分类可选的是全部二级目录
  const categories = computed(() => toValue(tree).flatMap(group => group.children ?? []));
  const editing = computed(() => draft.value !== null);
  const dirty = computed(() => draft.value !== null && isDirty(draft.value));
  // 编辑、保存中和详情加载失败时不能导入：导入会改属性，和草稿冲突
  const importer = useResourceImport(detail, () => !editing.value && !pending.value && !query.isError.value);
  // 进行中的写入（保存、导入）期间不能离开或换资源
  const writing = () => pending.value || importer.pending.value;

  function answerDiscard(discard: boolean) {
    confirming.value = false;
    resolveDiscard?.(discard);
    resolveDiscard = undefined;
  }

  onScopeDispose(() => {
    disposed = true;
    answerDiscard(false);
  });
  // 换会话时上一个会话的详情和草稿都不保留
  watch(
    () => session.token,
    () => {
      answerDiscard(false);
      draft.value = null;
      target.value = null;
      error.value = '';
    },
    { flush: 'sync' }
  );

  /** 能否离开当前详情：有未保存的修改时等用户确认。同一时间只有一个确认，后来的离开请求直接不允许，不共用前一次的回答 */
  async function allowLeave(): Promise<boolean> {
    if (disposed || writing() || confirming.value) {
      return false;
    }
    if (!dirty.value) {
      return true;
    }
    const token = sessionGuard.capture();
    confirming.value = true;
    const discard = await new Promise<boolean>(resolve => {
      resolveDiscard = resolve;
    });
    return discard && !disposed && sessionGuard.isCurrent(token);
  }

  function open(row: ResourceRecord, directoryId: string) {
    if (disposed || writing() || editing.value || confirming.value) {
      return;
    }
    target.value = { id: row.id, name: row.name, year: row.year, directoryId };
    error.value = '';
  }

  /** 返回列表；返回 false 表示没有离开（用户选择继续编辑，或保存中） */
  async function close(): Promise<boolean> {
    const token = sessionGuard.capture();
    if (!(await allowLeave()) || disposed || pending.value || !sessionGuard.isCurrent(token)) {
      return false;
    }
    draft.value = null;
    target.value = null;
    error.value = '';
    return true;
  }

  function beginEdit() {
    const base = detail.value;
    if (!base || disposed || editing.value || writing() || query.isError.value) {
      return;
    }
    draft.value = {
      base,
      category: matchCategory(base.resourceName, categories.value, target.value?.directoryId),
      // 复制一份：草稿的修改不能改到查询缓存里的详情
      attributes: base.attributes.map(attribute => Object.assign({}, attribute)),
      token: sessionGuard.capture()
    };
    error.value = '';
  }

  function setCategory(id: string) {
    const category = categories.value.find(node => node.id === id);
    if (!draft.value || pending.value || !category) {
      return;
    }
    draft.value = { ...draft.value, category: { id: category.id, name: category.name } };
    error.value = '';
  }

  function setName(index: number, name: string) {
    if (!draft.value || pending.value) {
      return;
    }
    const attributes = draft.value.attributes.map((attribute, position) => {
      // 清空表示没有名称，和后端的 null 一致
      return position === index ? { ...attribute, name: name || null } : attribute;
    });
    draft.value = { ...draft.value, attributes };
    error.value = '';
  }

  async function cancelEdit() {
    const token = sessionGuard.capture();
    if ((await allowLeave()) && !disposed && !pending.value && sessionGuard.isCurrent(token)) {
      draft.value = null;
      error.value = '';
    }
  }

  /** 返回是否保存成功；失败时保留草稿。成功就退出编辑，之后的重新读取失败也不再写入一次 */
  async function save(): Promise<boolean> {
    const current = draft.value;
    if (!current || pending.value || disposed || confirming.value || !dirty.value) {
      return false;
    }
    if (!sessionGuard.isCurrent(current.token)) {
      return false;
    }
    // 编辑期间目录可能刷新过（改名、删除），选的分类要仍在目录里
    const category = current.category;
    if (!category || !categories.value.some(node => node.id === category.id && node.name === category.name)) {
      error.value = '请选择有效的数据分类；目录可能已变更';
      return false;
    }
    pending.value = true;
    error.value = '';
    try {
      await mutation.mutateAsync({
        token: current.token,
        change: {
          id: current.base.id,
          resourceName: category.name,
          // 名称去掉首尾空格，空的传 null；其余字段原样往返
          attributes: current.attributes.map(attribute => ({ ...attribute, name: attribute.name?.trim() || null }))
        }
      });
      if (disposed || !sessionGuard.isCurrent(current.token)) {
        return false;
      }
      draft.value = null;
      return true;
    } catch (cause) {
      if (!disposed && sessionGuard.isCurrent(current.token)) {
        error.value = cause instanceof ApiError ? cause.message : '保存失败，请重试';
      }
      return false;
    } finally {
      pending.value = false;
    }
  }

  return {
    target: readonly(target),
    draft: computed(() => draft.value),
    detail,
    query,
    importer,
    editing,
    dirty,
    pending: readonly(pending),
    error: readonly(error),
    confirming: readonly(confirming),
    open,
    close,
    beginEdit,
    setCategory,
    setName,
    cancelEdit,
    save,
    allowLeave,
    answerDiscard
  };
}
