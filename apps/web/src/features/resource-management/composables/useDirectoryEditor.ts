import { type MaybeRefOrGetter, onScopeDispose, readonly, ref, shallowRef, toValue } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { ResourceDirectory, ResourceDirectoryChange } from '../api';
import { useResourceDirectoryMutation } from '../queries';

/** 弹窗持有打开时的节点快照，不能在确认期间悄悄换成另一节点 */
interface DirectoryTarget {
  kind: ResourceDirectoryChange['kind'];
  id: string;
  name: string;
  parentName: string;
  token: string;
}

/** 目录维护：同一页面串行写入，输入与请求状态独立于 Query 中的目录数据 */
export function useDirectoryEditor(tree: MaybeRefOrGetter<ResourceDirectory[]>) {
  const mutation = useResourceDirectoryMutation();
  const session = useSessionStore();
  const target = shallowRef<DirectoryTarget | null>(null);
  const name = ref('');
  const error = ref('');
  const pending = ref(false);
  let disposed = false;
  onScopeDispose(() => { disposed = true; });

  function open(kind: DirectoryTarget['kind'], id: string) {
    if (disposed || pending.value || target.value || !session.token || session.user?.role !== Role.admin) {
      return;
    }
    const groups = toValue(tree);
    const parent = kind === 'add' ? groups.find(group => group.id === id)
      : groups.find(group => group.children?.some(child => child.id === id));
    const node = kind === 'add' ? parent : parent?.children?.find(child => child.id === id);
    if (!parent || !node) {
      return;
    }
    target.value = { kind, id, name: node.name, parentName: parent.name, token: session.token };
    name.value = kind === 'rename' ? node.name : '';
    error.value = '';
  }

  function close() {
    if (!pending.value) {
      target.value = null;
      error.value = '';
    }
  }

  function setName(value: string) {
    if (!pending.value) {
      name.value = value;
      error.value = '';
    }
  }

  /** 返回是否完成本次写入；卸载或会话变化后不再返回成功，也不显示旧会话错误 */
  async function submit(): Promise<boolean> {
    const current = target.value;
    if (!current || pending.value || disposed) {
      return false;
    }
    if (session.token !== current.token || session.user?.role !== Role.admin) {
      close();
      return false;
    }
    const groups = toValue(tree);
    const nodes = current.kind === 'add' ? groups : groups.flatMap(group => group.children ?? []);
    if (!nodes.some(node => node.id === current.id && node.name === current.name)) {
      error.value = '目录已变化，请关闭后重新操作';
      return false;
    }
    const trimmed = name.value.trim();
    if (current.kind !== 'remove' && (!trimmed || trimmed.length > 20)) {
      error.value = trimmed ? '目录名称不能超过 20 个字符' : '请输入目录名称';
      return false;
    }
    if (current.kind === 'rename' && trimmed === current.name) {
      close();
      return false;
    }
    let change: ResourceDirectoryChange;
    if (current.kind === 'add') {
      change = { kind: 'add', parentId: current.id, name: trimmed };
    } else if (current.kind === 'rename') {
      change = { kind: 'rename', id: current.id, name: trimmed };
    } else {
      change = { kind: 'remove', id: current.id };
    }
    pending.value = true;
    error.value = '';
    try {
      await mutation.mutateAsync({ change, token: current.token });
      if (disposed || session.token !== current.token) {
        return false;
      }
      target.value = null;
      return true;
    } catch (cause) {
      if (!disposed && session.token === current.token) {
        error.value = cause instanceof ApiError ? cause.message : '操作失败，请重试';
      }
      return false;
    } finally {
      pending.value = false;
    }
  }

  return {
    target: readonly(target),
    name: readonly(name),
    error: readonly(error),
    pending: readonly(pending),
    open,
    close,
    setName,
    submit
  };
}
