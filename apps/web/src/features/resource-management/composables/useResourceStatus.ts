import { type MaybeRefOrGetter, onScopeDispose, readonly, shallowReactive, toValue, watch } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { ResourceRecord } from '../api';
import { useResourceStatusMutation } from '../queries';

interface StatusOperation {
  id: string;
  enabled: boolean;
  token: string | undefined;
}

/** 一次启停的结果；null 表示没有发出，或页面已销毁、换了会话，界面不提示 */
export type StatusResult = { kind: 'success'; enabled: boolean } | { kind: 'error'; message: string } | null;

/**
 * 图层启停：按资源 ID 防重复，不同资源可以同时进行；目标状态取当前记录的反面，结果由查询重新读取确认。
 * available 为 false（列表正在刷新或出错，显示的状态可能已过时）时不发出
 */
export function useResourceStatus(rows: MaybeRefOrGetter<ResourceRecord[]>, available: MaybeRefOrGetter<boolean>) {
  const mutation = useResourceStatusMutation();
  const session = useSessionStore();
  const sessionGuard = useSessionGuard();
  // 进行中的操作，按资源 ID；收尾时核对是不是同一次操作
  const pending = shallowReactive(new Map<string, StatusOperation>());
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  // 换会话后旧操作的结果不再显示，新会话可以立即操作同一资源
  watch(() => session.token, () => pending.clear(), { flush: 'sync' });

  async function toggle(id: string): Promise<StatusResult> {
    const row = toValue(rows).find(item => item.id === id);
    if (!row || disposed || pending.has(id) || !toValue(available)) {
      return null;
    }
    const operation: StatusOperation = { id, enabled: !row.enabled, token: sessionGuard.capture() };
    pending.set(id, operation);
    try {
      await mutation.mutateAsync(operation);
      if (disposed || !sessionGuard.isCurrent(operation.token)) {
        return null;
      }
      return { kind: 'success', enabled: operation.enabled };
    } catch (cause) {
      if (disposed || !sessionGuard.isCurrent(operation.token)) {
        return null;
      }
      return { kind: 'error', message: cause instanceof ApiError ? cause.message : '启停操作失败，请重试' };
    } finally {
      // 换会话后同一资源可能已有新操作，旧操作的收尾不能解除它的防重复
      if (pending.get(id) === operation) {
        pending.delete(id);
      }
    }
  }

  return { pending: readonly(pending), toggle };
}
