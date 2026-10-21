import { type Query, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import {
  changeResourceDirectory,
  fetchResourceDirectory,
  fetchResourceDetail,
  fetchResourcePage,
  fetchResourceYears,
  saveResourceDetail,
  type ResourceDetail,
  type ResourceDetailChange,
  type ResourcePage,
  type ResourcePageParams,
  type ResourceDirectoryChange
} from './api';

/** 目录 ID 隔离同名节点的缓存；params 中的名称是本次请求使用的目录名称 */
export interface ResourcePageRequest {
  directoryId: string;
  params: ResourcePageParams;
}

export interface ResourcePageEntry {
  request: ResourcePageRequest | null;
  page: ResourcePage;
}

type ResourcePageQuery = Query<ResourcePage, Error, ResourcePage, ReturnType<typeof resourceManagementKeys.page>>;

/** 资源管理的查询与失效入口，独立于现状底图和文件管理的缓存 */
export const resourceManagementKeys = {
  all: ['resource-management'] as const,
  directory: () => [...resourceManagementKeys.all, 'directory'] as const,
  years: () => [...resourceManagementKeys.all, 'years'] as const,
  pages: () => [...resourceManagementKeys.all, 'page'] as const,
  page: (request: ResourcePageRequest | null) => [...resourceManagementKeys.pages(), request] as const,
  details: () => [...resourceManagementKeys.all, 'detail'] as const,
  detail: (id: string | null) => [...resourceManagementKeys.details(), id] as const
};

/** 目录缓存由 Query 持有；组件只从缓存推导当前选择 */
export function useResourceDirectoryQuery() {
  return useQuery({
    queryKey: resourceManagementKeys.directory(),
    queryFn: ({ signal }) => fetchResourceDirectory(signal)
  });
}

/** 年份与目录独立加载；年份失败不阻止查看未限定年份的列表 */
export function useResourceYearsQuery() {
  return useQuery({
    queryKey: resourceManagementKeys.years(),
    queryFn: ({ signal }) => fetchResourceYears(signal)
  });
}

/** 写入成功后先更新目录身份，再刷新列表；旧会话的晚到结果不触碰新会话缓存 */
export function useResourceDirectoryMutation() {
  const queryClient = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: ({ change }: { change: ResourceDirectoryChange; token: string }) => changeResourceDirectory(change),
    onSuccess: async (_, { token }) => {
      if (session.token !== token) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: resourceManagementKeys.directory() });
      if (session.token === token) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.pages() }),
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.details() })
        ]);
      }
    }
  });
}

/** 没有有效二级目录时不查询；同目录内换条件保留占位，换目录或重命名时不保留 */
export function useResourcePageQuery(request: MaybeRefOrGetter<ResourcePageRequest | null>) {
  const queryClient = useQueryClient();
  const query = useQuery(computed(() => {
    const current = toValue(request);
    const queryFn = current
      ? ({ signal }: { signal: AbortSignal }) => fetchResourcePage(current.params, signal)
      : skipToken;
    return {
      queryKey: resourceManagementKeys.page(current),
      queryFn,
      placeholderData: (previous: ResourcePage | undefined, previousQuery: ResourcePageQuery | undefined) => {
        // 当前条件已经失败过且没有缓存时，重试不重新显示另一页的占位记录
        const state = queryClient.getQueryState(resourceManagementKeys.page(current));
        if (state && state.data === undefined && state.errorUpdatedAt > 0) {
          return undefined;
        }
        const previousRequest = previousQuery?.queryKey[2];
        return current && previousRequest?.directoryId === current.directoryId &&
          previousRequest.params.resource === current.params.resource ? previous : undefined;
      },
      // key 改变后 data 到下一轮调度才更新；带上身份，防止旧响应修正新目录的页码和总数
      select: (page: ResourcePage): ResourcePageEntry => ({ request: current, page })
    };
  }));

  /** 后端修正页码后先登记对应页的成功结果，切到该页时不闪回过时缓存 */
  function rememberPage(current: ResourcePageRequest, page: ResourcePage) {
    queryClient.setQueryData(resourceManagementKeys.page(current), page);
  }

  return { ...query, rememberPage };
}

/** 详情不借用其他资源占位；标记所属 ID，避免 key 切换当轮读取旧值 */
export function useResourceDetailQuery(id: MaybeRefOrGetter<string | null>) {
  return useQuery(computed(() => {
    const current = toValue(id);
    return {
      queryKey: resourceManagementKeys.detail(current),
      queryFn: current ? ({ signal }: { signal: AbortSignal }) => fetchResourceDetail(current, signal) : skipToken,
      select: (detail: ResourceDetail) => ({ id: current, detail })
    };
  }));
}

/** 保存是不可替换的服务端写操作；只刷新同会话的详情与列表 */
export function useResourceDetailMutation() {
  const queryClient = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: ({ change }: { change: ResourceDetailChange; token: string }) => saveResourceDetail(change),
    onSuccess: async (_, { change, token }) => {
      if (session.token === token) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.detail(change.id) }),
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.pages() })
        ]);
      }
    }
  });
}
