import { computed, type MaybeRefOrGetter, onScopeDispose, reactive, ref, toValue, watch } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { ApiError } from '@/shared/http/errors';
import { type AuditSubmission, useApplicationQuery, useAuditApplicationMutation } from '../queries';

/** 审核意见；不通过时必须填原因（校验由界面负责） */
export interface AuditForm {
  approved: boolean;
  reason: string;
}

/** 打开的申请处在哪一步：没有打开、读取中、读取失败、不存在、可以显示 */
export type ReviewState = 'closed' | 'loading' | 'error' | 'missing' | 'ready';

/** 弹窗的模式：填审核意见，或只查看 */
export type ReviewMode = 'audit' | 'view';

/** 一次审核的结果；null 表示没有发出，或页面已销毁、换了会话，界面不提示 */
export type AuditResult =
  | { kind: 'success'; id: string; approved: boolean }
  | { kind: 'error'; message: string }
  | null;

const emptyForm = (): AuditForm => ({ approved: true, reason: '' });

// 打开的申请（ID 来自路由的查询参数，ADR 0092）：读取和它处在哪一步
function useOpenedApplication(applyId: MaybeRefOrGetter<string | null>) {
  const query = useApplicationQuery(applyId);

  // 查询换 key 后 data 要到下一轮才更新，只认标着当前 ID 的结果
  const entry = computed(() => {
    const id = toValue(applyId);
    const data = query.data.value;
    return id !== null && data?.id === id ? data : undefined;
  });
  const application = computed(() => entry.value?.application ?? null);

  const state = computed<ReviewState>(() => {
    if (toValue(applyId) === null) {
      return 'closed';
    }
    if (entry.value) {
      return entry.value.application ? 'ready' : 'missing';
    }
    return query.isError.value ? 'error' : 'loading';
  });

  return { application, state, retry: () => void query.refetch() };
}

/**
 * 打开的申请与审核：待审核的填审核意见，其余只查看，模式由申请当前的状态决定。
 * 提交期间不能重复提交；失败时保留填写的内容。不渲染、不跳转、不提示；send 默认是真实的审核接口，组件样例传入演示的提交
 */
export function useApplicationReview(
  applyId: MaybeRefOrGetter<string | null>,
  send: (submission: AuditSubmission) => Promise<unknown> = useAuditApplicationMutation().mutateAsync
) {
  const sessionGuard = useSessionGuard();
  const opened = useOpenedApplication(applyId);
  const { application } = opened;
  const form = reactive<AuditForm>(emptyForm());
  const pending = ref(false);
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

  // 换了一条申请，审核意见从头填
  watch(
    () => toValue(applyId),
    () => {
      Object.assign(form, emptyForm());
    },
    { flush: 'sync' }
  );

  const mode = computed<ReviewMode>(() => (application.value?.status === 'pending' ? 'audit' : 'view'));

  async function submit(): Promise<AuditResult> {
    const current = application.value;
    if (!current || current.status !== 'pending' || pending.value) {
      return null;
    }
    const audit = { id: current.id, approved: form.approved, reason: form.reason.trim() };
    pending.value = true;
    const token = sessionGuard.capture();
    try {
      await send({ audit, token });
      if (disposed || !sessionGuard.isCurrent(token)) {
        return null;
      }
      return { kind: 'success', id: audit.id, approved: audit.approved };
    } catch (cause) {
      if (disposed || !sessionGuard.isCurrent(token)) {
        return null;
      }
      return { kind: 'error', message: cause instanceof ApiError ? cause.message : '审核提交失败，请重试' };
    } finally {
      pending.value = false;
    }
  }

  return { ...opened, mode, form, pending, submit };
}

export type ApplicationReviewOwner = ReturnType<typeof useApplicationReview>;

/** 申请人查看自己的申请（ADR 0127）：和审核共用一个弹窗，所以形状相同；总是只查看，待审核的也不能提交，也不创建审核的请求 */
export function useApplicationView(applyId: MaybeRefOrGetter<string | null>): ApplicationReviewOwner {
  return {
    ...useOpenedApplication(applyId),
    mode: computed<ReviewMode>(() => 'view'),
    form: reactive(emptyForm()),
    pending: ref(false),
    submit: () => Promise.resolve(null)
  };
}
