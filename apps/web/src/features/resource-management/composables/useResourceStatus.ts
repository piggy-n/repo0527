import { type MaybeRefOrGetter, onScopeDispose, readonly, shallowReactive, toValue, watch } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { ResourceRecord } from '../api';
import { useResourceStatusMutation } from '../queries';

interface StatusOperation {
  id: string;
  enabled: boolean;
  token: string;
}

type StatusResult = { kind: 'success'; enabled: boolean } | { kind: 'error'; message: string } | null;

/** 按资源 ID 防重复，不同 ID 可并发；输入取当前记录，结果由 Query 重新确认 */
export function useResourceStatus(
  rows: MaybeRefOrGetter<ResourceRecord[]>,
  available: MaybeRefOrGetter<boolean>
) {
  const session = useSessionStore();
  const mutation = useResourceStatusMutation();
  const pending = shallowReactive(new Map<string, StatusOperation>());
  let disposed = false;
  onScopeDispose(() => { disposed = true; });
  watch(() => session.token, () => pending.clear(), { flush: 'sync' });

  async function toggle(id: string): Promise<StatusResult> {
    const row = toValue(rows).find(item => item.id === id);
    if (!row || disposed || pending.has(id) || !toValue(available) || !session.token ||
      !session.isActive() || session.user?.role !== Role.admin) { return null; }
    const operation = { id, enabled: !row.enabled, token: session.token };
    pending.set(id, operation);
    try {
      await mutation.mutateAsync(operation);
      if (disposed || session.token !== operation.token) { return null; }
      return { kind: 'success', enabled: operation.enabled };
    } catch (cause) {
      if (disposed || session.token !== operation.token || (cause instanceof ApiError && cause.kind === 'canceled')) {
        return null;
      }
      return { kind: 'error', message: cause instanceof ApiError ? cause.message : '启停操作失败，请重试' };
    } finally {
      // 会话改变后同 ID 可能已有新操作，旧结果不能解除新操作的防重复状态
      if (pending.get(id) === operation) { pending.delete(id); }
    }
  }

  return { pending: readonly(pending), toggle };
}
