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

export function useAuditMutation() {
  const guard = useSessionGuard();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, token }: { input: AuditInput; token: string | undefined }) => {
      guard.assertCurrent(token);
      await auditApplication(input);
      return guard.isCurrent(token);
    },
    onSuccess: (current, { input }) => {
      if (current) {
        void client.invalidateQueries({ queryKey: listKey });
        void client.invalidateQueries({ queryKey: detailKey(input.id) });
      }
    }
  });
}
