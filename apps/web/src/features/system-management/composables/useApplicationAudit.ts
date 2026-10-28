import { computed, onScopeDispose, ref, watch } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { AuditDecision } from '../api';
import { useApplicationQuery, useAuditMutation } from '../queries';

/** 申请详情和审核表单，读请求可取消，已发出的审核不中止 */
export function useApplicationAudit() {
  const selectedId = ref<string>();
  const decision = ref<AuditDecision | ''>('');
  const reason = ref('');
  const failure = ref('');
  const submitting = ref(false);
  const session = useSessionStore();
  const guard = useSessionGuard();
  const query = useApplicationQuery(selectedId);
  const mutation = useAuditMutation();
  let disposed = false;
  const detail = computed(() => query.data.value?.apply_id === selectedId.value ? query.data.value : undefined);
  // 再次打开时重新读取，刷新失败不能凭旧的待审核缓存提交
  const editable = computed(() =>
    detail.value?.status === 'pending' && !query.isFetching.value && !query.isError.value
  );

  function close() {
    selectedId.value = undefined;
  }

  watch(
    selectedId,
    () => {
      decision.value = '';
      reason.value = '';
      failure.value = '';
    },
    { flush: 'sync' }
  );
  // 换会话后旧申请的弹窗不再留着
  watch(() => session.token, close, { flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
  });

  function open(id: string) {
    if (!submitting.value) {
      selectedId.value = id;
    }
  }

  /** 返回成功时由界面提示，错误及校验信息留在表单内 */
  async function submit(): Promise<boolean> {
    if (!editable.value || !selectedId.value || submitting.value) {
      return false;
    }
    failure.value = '';
    if (!decision.value) {
      failure.value = '请选择审核结果';
      return false;
    }
    if (decision.value === 'rejected' && !reason.value.trim()) {
      failure.value = '请填写不通过原因';
      return false;
    }
    if (reason.value.trim().length > 500) {
      failure.value = '不通过原因不能超过 500 字';
      return false;
    }
    const token = guard.capture();
    const id = selectedId.value;
    submitting.value = true;
    try {
      const input = { id, status: decision.value, reason: reason.value.trim() };
      await mutation.mutateAsync({ input, token });
      if (disposed || !guard.isCurrent(token) || selectedId.value !== id) {
        return false;
      }
      close();
      return true;
    } catch (error) {
      if (!disposed && guard.isCurrent(token) && selectedId.value === id) {
        failure.value = error instanceof ApiError ? error.message : '审核提交失败，请重试';
      }
      return false;
    } finally {
      submitting.value = false;
    }
  }

  return {
    selectedId,
    detail,
    decision,
    reason,
    failure,
    submitting,
    editable,
    loading: query.isFetching,
    loadFailed: query.isError,
    retry: query.refetch,
    open,
    close,
    submit
  };
}
