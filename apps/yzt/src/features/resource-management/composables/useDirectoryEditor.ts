import { type MaybeRefOrGetter, onScopeDispose, readonly, ref, shallowRef, toValue } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { ApiError } from '@/shared/http/errors';
import type { ResourceDirectory, ResourceDirectoryChange } from '../api';
import { useResourceDirectoryMutation } from '../queries';

/** 目录名称的最大长度，和旧页面的输入框一致 */
export const DIRECTORY_NAME_MAX_LENGTH = 20;

/** 打开弹窗时记下的节点快照：确认期间目录刷新了，也不能悄悄换成另一个节点 */
interface DirectoryTarget {
  kind: ResourceDirectoryChange['kind'];
  // 新增时是一级分组的 ID，改名、删除时是二级目录的 ID
  id: string;
  name: string;
  token: string | undefined;
}

// 新增挂在一级分组下，改名、删除只针对二级目录
function findNode(tree: ResourceDirectory[], kind: DirectoryTarget['kind'], id: string) {
  const nodes = kind === 'add' ? tree : tree.flatMap(group => group.children ?? []);
  return nodes.find(node => node.id === id);
}

function toChange(target: DirectoryTarget, name: string): ResourceDirectoryChange {
  if (target.kind === 'add') {
    return { kind: 'add', parentId: target.id, name };
  }
  if (target.kind === 'rename') {
    return { kind: 'rename', id: target.id, name };
  }
  return { kind: 'remove', id: target.id };
}

/** 目录维护：一个页面同时只有一次写入；输入和请求状态在这里，目录数据仍在查询缓存。不渲染、不提示 */
export function useDirectoryEditor(tree: MaybeRefOrGetter<ResourceDirectory[]>) {
  const mutation = useResourceDirectoryMutation();
  const sessionGuard = useSessionGuard();
  const target = shallowRef<DirectoryTarget | null>(null);
  const name = ref('');
  const error = ref('');
  const pending = ref(false);
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

  /** 开始一次维护；写入进行中或已有打开的弹窗时忽略 */
  function open(kind: DirectoryTarget['kind'], id: string) {
    if (disposed || pending.value || target.value) {
      return;
    }
    const node = findNode(toValue(tree), kind, id);
    if (!node) {
      return;
    }
    target.value = { kind, id, name: node.name, token: sessionGuard.capture() };
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

  // 名称不合法时返回提示；删除不需要名称
  function validateName(current: DirectoryTarget, trimmed: string): string {
    if (current.kind === 'remove') {
      return '';
    }
    if (!trimmed) {
      return '请输入目录名称';
    }
    return trimmed.length > DIRECTORY_NAME_MAX_LENGTH ? `目录名称不能超过 ${DIRECTORY_NAME_MAX_LENGTH} 个字符` : '';
  }

  /** 返回是否完成写入；页面销毁或换了会话后不再返回成功，也不显示旧会话的错误 */
  async function submit(): Promise<boolean> {
    const current = target.value;
    if (!current || pending.value || disposed) {
      return false;
    }
    if (!sessionGuard.isCurrent(current.token)) {
      close();
      return false;
    }
    // 打开弹窗之后目录刷新过：节点被删或改了名，不按旧快照写入
    if (findNode(toValue(tree), current.kind, current.id)?.name !== current.name) {
      error.value = '目录已变化，请关闭后重新操作';
      return false;
    }
    const trimmed = name.value.trim();
    error.value = validateName(current, trimmed);
    if (error.value) {
      return false;
    }
    // 名称没变的改名不用写入
    if (current.kind === 'rename' && trimmed === current.name) {
      close();
      return false;
    }

    pending.value = true;
    try {
      await mutation.mutateAsync({ change: toChange(current, trimmed), token: current.token });
      if (disposed || !sessionGuard.isCurrent(current.token)) {
        return false;
      }
      target.value = null;
      return true;
    } catch (cause) {
      if (!disposed && sessionGuard.isCurrent(current.token)) {
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
