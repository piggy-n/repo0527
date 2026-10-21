import { computed, type MaybeRefOrGetter, onScopeDispose, readonly, ref, shallowRef, toValue, watch } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { ResourceAttribute, ResourceDetail, ResourceDirectory, ResourceRecord } from '../api';
import { useResourceDetailMutation, useResourceDetailQuery } from '../queries';

interface DetailTarget {
  id: string;
  name: string;
  year: number | null;
  directoryId: string;
}

interface DetailDraft {
  base: ResourceDetail;
  category: { id: string; name: string } | null;
  attributes: ResourceAttribute[];
  token: string;
}

/** 编辑仅保存可改字段的草稿；读取、缓存刷新与服务端写操作各自管理生命周期 */
export function useResourceDetail(tree: MaybeRefOrGetter<ResourceDirectory[]>) {
  const session = useSessionStore();
  const target = shallowRef<DetailTarget | null>(null);
  const draft = shallowRef<DetailDraft | null>(null);
  const pending = ref(false);
  const error = ref('');
  const confirming = ref(false);
  let resolveDiscard: ((value: boolean) => void) | undefined;
  let disposed = false;
  const query = useResourceDetailQuery(() => target.value?.id ?? null);
  const mutation = useResourceDetailMutation();
  const detail = computed(() => query.data.value?.id === target.value?.id ? query.data.value?.detail : undefined);
  const categories = computed(() => toValue(tree).flatMap(group => group.children ?? []));
  const editing = computed(() => draft.value !== null);
  const dirty = computed(() => {
    const current = draft.value;
    return current !== null && ((current.category?.name ?? current.base.resourceName) !== current.base.resourceName ||
      current.attributes.some((attribute, index) => attribute.name !== current.base.attributes[index]?.name));
  });

  function answerDiscard(discard: boolean) {
    confirming.value = false;
    resolveDiscard?.(discard);
    resolveDiscard = undefined;
  }

  onScopeDispose(() => {
    disposed = true;
    answerDiscard(false);
  });
  watch(() => session.token, () => {
    answerDiscard(false);
    draft.value = null;
    target.value = null;
    error.value = '';
  }, { flush: 'sync' });

  /** 单一确认通道；后续点击不复用第一次的许可，避免一次确认触发多个导航 */
  async function allowLeave(): Promise<boolean> {
    if (disposed || pending.value || confirming.value) { return false; }
    if (!dirty.value) { return true; }
    const token = session.token;
    confirming.value = true;
    const discard = await new Promise<boolean>(resolve => { resolveDiscard = resolve; });
    return discard && !disposed && session.token === token;
  }

  function open(row: ResourceRecord, directoryId: string) {
    if (disposed || pending.value || editing.value || confirming.value) { return; }
    target.value = { id: row.id, name: row.name, year: row.year, directoryId };
    error.value = '';
  }

  async function close(): Promise<boolean> {
    const token = session.token;
    if (!await allowLeave() || disposed || pending.value || session.token !== token) { return false; }
    draft.value = null;
    target.value = null;
    error.value = '';
    return true;
  }

  function beginEdit() {
    const base = detail.value;
    if (!base || editing.value || pending.value || query.isError.value || disposed ||
      !session.isActive() || !session.token || session.user?.role !== Role.admin) { return; }
    const matches = categories.value.filter(node => node.name === base.resourceName);
    const category = matches.find(node => node.id === target.value?.directoryId) ??
      (matches.length === 1 ? matches[0] : undefined);
    draft.value = {
      base,
      category: category ? { id: category.id, name: category.name } : null,
      attributes: base.attributes.map(attribute => Object.assign({}, attribute)),
      token: session.token
    };
    error.value = '';
  }

  function setCategory(id: string) {
    const category = categories.value.find(node => node.id === id);
    if (!draft.value || pending.value || !category) { return; }
    draft.value = { ...draft.value, category: { id: category.id, name: category.name } };
    error.value = '';
  }

  function setName(index: number, name: string) {
    if (!draft.value || pending.value) { return; }
    draft.value = { ...draft.value, attributes: draft.value.attributes.map((attribute, position) =>
      position === index ? { ...attribute, name: name || null } : attribute) };
    error.value = '';
  }

  async function cancelEdit() {
    const token = session.token;
    if (await allowLeave() && !disposed && !pending.value && session.token === token) {
      draft.value = null;
      error.value = '';
    }
  }

  /** 保存失败保留原始草稿；成功退出编辑，即使随后的读取失败也不重复写入 */
  async function save(): Promise<boolean> {
    const current = draft.value;
    if (!current || pending.value || disposed || confirming.value || !dirty.value ||
      session.token !== current.token || !session.isActive() || session.user?.role !== Role.admin) { return false; }
    if (!categories.value.some(node => node.id === current.category?.id && node.name === current.category.name)) {
      error.value = '请选择有效的数据分类；目录可能已变更';
      return false;
    }
    pending.value = true;
    error.value = '';
    try {
      await mutation.mutateAsync({ token: current.token, change: {
        id: current.base.id,
        resourceName: current.category!.name,
        attributes: current.attributes.map(attribute => ({ ...attribute, name: attribute.name?.trim() || null }))
      } });
      if (disposed || session.token !== current.token) { return false; }
      draft.value = null;
      return true;
    } catch (cause) {
      if (!disposed && session.token === current.token) {
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
    editing,
    dirty,
    pending: readonly(pending),
    error: readonly(error),
    confirming: readonly(confirming),
    open, close, beginEdit, setCategory, setName, cancelEdit, save, allowLeave, answerDiscard
  };
}
