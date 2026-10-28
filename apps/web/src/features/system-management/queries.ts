import { hashKey, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { auditApplication, fetchApplication, fetchSystemPage, type AuditInput, type SystemPageRequest } from './api';

const listKey = ['system-management', 'list'] as const;
const detailKey = (id: string) => ['system-management', 'application', id] as const;

/** 列表占位数据只在同类列表内使用，结果标明对应条件 */
export function useSystemPageQuery(request: Ref<SystemPageRequest>) {
  return useQuery(computed(() => {
    const current = request.value;
    const requestKey = hashKey([current]);
    return {
      queryKey: [...listKey, current],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchSystemPage(current, signal),
      select: (page: Awaited<ReturnType<typeof fetchSystemPage>>) => ({ page, requestKey }),
      placeholderData: (previous: Awaited<ReturnType<typeof fetchSystemPage>> | undefined) => previous
    };
  }));
}

/** 切换申请时不使用上一份详情占位，弹窗关闭即取消读取 */
export function useApplicationQuery(id: Ref<string | undefined>) {
  return useQuery(computed(() => {
    const current = id.value;
    return {
      queryKey: detailKey(current ?? ''),
      queryFn: current ? ({ signal }: { signal: AbortSignal }) => fetchApplication(current, signal) : skipToken
    };
  }));
}

/** 写操作的参数带上提交时的会话（useSessionGuard 的 capture） */
interface AuditSubmission {
  input: AuditInput;
  token: string | undefined;
}

/** 审核不随弹窗关闭取消；旧会话的结果不刷新新会话的缓存 */
export function useAuditMutation() {
  const guard = useSessionGuard();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ input, token }: AuditSubmission) => {
      guard.assertCurrent(token);
      return auditApplication(input);
    },
    onSuccess: (_result, { input, token }) => {
      if (guard.isCurrent(token)) {
        void client.invalidateQueries({ queryKey: listKey });
        void client.invalidateQueries({ queryKey: detailKey(input.id) });
      }
    }
  });
}
