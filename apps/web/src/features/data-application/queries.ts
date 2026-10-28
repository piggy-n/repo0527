import { keepPreviousData, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import {
  type Application,
  type ApplicationAudit,
  type ApplicationPage,
  type ApplicationPageParams,
  auditApplication,
  fetchApplication,
  fetchApplicationPage
} from './api';

/** 申请的 query key 只在这里拼，查询和失效共用 */
export const applicationKeys = {
  all: ['data-application'] as const,
  pages: () => [...applicationKeys.all, 'page'] as const,
  page: (params: ApplicationPageParams) => [...applicationKeys.pages(), params] as const,
  details: () => [...applicationKeys.all, 'detail'] as const,
  detail: (id: string) => [...applicationKeys.details(), id] as const
};

/**
 * 申请列表的一页；换条件、翻页时保留上一次的数据，由表格显示遮罩（docs/modules/table.md）。
 * rememberPage 把后端修正过页码的结果记到修正后的页上，页码跟过去时不再请求一次
 */
export function useApplicationPageQuery(params: MaybeRefOrGetter<ApplicationPageParams>) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: computed(() => applicationKeys.page(toValue(params))),
    // 参数从 key 里取，请求用的参数和缓存的 key 一定一致
    queryFn: ({ queryKey: [, , page], signal }) => fetchApplicationPage(page, signal),
    placeholderData: keepPreviousData
  });

  function rememberPage(pageParams: ApplicationPageParams, page: ApplicationPage) {
    queryClient.setQueryData(applicationKeys.page(pageParams), page);
  }

  return { ...query, rememberPage };
}

/** 带上所属 ID 的一条申请：key 换了以后 data 要到下一轮调度才更新，读的一方按 ID 判断是不是自己要的那条 */
export interface ApplicationEntry {
  id: string;
  // 申请不存在时是 null
  application: Application | null;
}

/** 打开的申请；没有 ID 时不请求 */
export function useApplicationQuery(id: MaybeRefOrGetter<string | null>) {
  return useQuery(
    computed(() => {
      const current = toValue(id);
      const queryFn = current === null
        ? skipToken
        : ({ signal }: { signal: AbortSignal }) => fetchApplication(current, signal);
      return {
        queryKey: applicationKeys.detail(current ?? ''),
        queryFn,
        // 缓存里只存申请，读出时标上 ID
        select: (application: Application | null): ApplicationEntry => ({ id: current ?? '', application })
      };
    })
  );
}

/** 写操作的参数都带上提交时的会话（useSessionGuard 的 capture） */
interface AuditSubmission {
  audit: ApplicationAudit;
  token: string | undefined;
}

/** 审核申请；请求发出后后端就会执行，不随组件卸载取消。成功后让原会话的列表和这条申请失效 */
export function useAuditApplicationMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ audit, token }: AuditSubmission) => {
      // 从提交到真正发请求之间可能已换会话，不能用新会话的凭据提交旧会话的审核
      sessionGuard.assertCurrent(token);
      return auditApplication(audit);
    },
    // 旧会话的结果不刷新新会话的缓存
    onSuccess: (_data, { token }) =>
      sessionGuard.isCurrent(token) ? queryClient.invalidateQueries({ queryKey: applicationKeys.all }) : undefined
  });
}
