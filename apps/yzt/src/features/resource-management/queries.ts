import { type Query, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import type { TransferProgress } from '@/shared/http/client';
import {
  changeResourceDirectory,
  createDataApplication,
  type DataApplication,
  fetchResourceDetail,
  fetchResourceDirectory,
  fetchResourcePage,
  fetchResourceYears,
  importResourceExcel,
  type ResourceDetail,
  type ResourceDetailChange,
  type ResourceDirectoryChange,
  type ResourceExcelImport,
  type ResourcePage,
  type ResourcePageParams,
  saveResourceDetail,
  setResourceStatus
} from './api';

/** 列表请求：目录 ID 区分同名目录的缓存，params 里是这次请求用的目录名称（接口只接收名称） */
export interface ResourcePageRequest {
  directoryId: string;
  params: ResourcePageParams;
}

/** 带上所属请求的一页结果，见 useResourcePageQuery 的 select */
export interface ResourcePageEntry {
  request: ResourcePageRequest | null;
  page: ResourcePage;
}

type ResourcePageQuery = Query<ResourcePage, Error, ResourcePage, ReturnType<typeof resourceManagementKeys.page>>;

/** 资源管理的 query key 只在这里拼；和现状底图的资源目录、文件管理的缓存互不影响 */
export const resourceManagementKeys = {
  all: ['resource-management'] as const,
  directory: () => [...resourceManagementKeys.all, 'directory'] as const,
  years: () => [...resourceManagementKeys.all, 'years'] as const,
  pages: () => [...resourceManagementKeys.all, 'page'] as const,
  page: (request: ResourcePageRequest | null) => [...resourceManagementKeys.pages(), request] as const,
  details: () => [...resourceManagementKeys.all, 'detail'] as const,
  detail: (id: string | null) => [...resourceManagementKeys.details(), id] as const
};

/** 资源目录；当前选中的目录由列表的拥有者从缓存推导 */
export function useResourceDirectoryQuery() {
  return useQuery({
    queryKey: resourceManagementKeys.directory(),
    queryFn: ({ signal }) => fetchResourceDirectory(signal)
  });
}

/** 年份和目录分开加载：年份加载失败时仍能查看不限年份的列表 */
export function useResourceYearsQuery() {
  return useQuery({
    queryKey: resourceManagementKeys.years(),
    queryFn: ({ signal }) => fetchResourceYears(signal)
  });
}

/** 没有可选的二级目录时不请求；同一目录内换条件、翻页时保留上一次的数据，换目录或目录改名时不保留 */
export function useResourcePageQuery(request: MaybeRefOrGetter<ResourcePageRequest | null>) {
  const queryClient = useQueryClient();
  const query = useQuery(computed(() => {
    const current = toValue(request);
    return {
      queryKey: resourceManagementKeys.page(current),
      queryFn: current ? ({ signal }: { signal: AbortSignal }) => fetchResourcePage(current.params, signal) : skipToken,
      placeholderData: (previous: ResourcePage | undefined, previousQuery: ResourcePageQuery | undefined) => {
        // 这组条件失败过、又没有缓存：重试时不再拿别的页占位，否则失败提示下面显示的是另一页
        const state = queryClient.getQueryState(resourceManagementKeys.page(current));
        if (state && state.data === undefined && state.errorUpdatedAt > 0) {
          return undefined;
        }
        const previousRequest = previousQuery?.queryKey[2];
        const sameDirectory =
          current !== null &&
          previousRequest?.directoryId === current.directoryId &&
          previousRequest.params.resource === current.params.resource;
        return sameDirectory ? previous : undefined;
      },
      // key 变化后 data 要到下一轮调度才换成新 key 的结果；标上所属请求，旧结果不能修正新目录的页码和总数
      select: (page: ResourcePage): ResourcePageEntry => ({ request: current, page })
    };
  }));

  /** 后端把越界的页码修正到最后一页时，把这页结果登记到修正后的 key 下：切过去时直接显示，不再请求一次 */
  function rememberPage(current: ResourcePageRequest, page: ResourcePage) {
    queryClient.setQueryData(resourceManagementKeys.page(current), page);
  }

  return { ...query, rememberPage };
}

/** 资源详情；不借用其他资源的数据占位，结果标上所属 ID（同 useResourcePageQuery 的 select） */
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

// 下面的写操作都不传 signal：请求发出后后端就会执行，组件卸载也不取消。
// 参数都带上提交时的会话（useSessionGuard 的 capture）：发请求前确认没换会话，旧会话的结果不刷新新会话的缓存

interface DirectorySubmission {
  change: ResourceDirectoryChange;
  token: string | undefined;
}

/** 新增、改名、删除目录；成功后先刷新目录（选中的目录可能已不存在），再刷新列表和详情 */
export function useResourceDirectoryMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ change, token }: DirectorySubmission) => {
      sessionGuard.assertCurrent(token);
      return changeResourceDirectory(change);
    },
    onSuccess: async (_data, { token }) => {
      if (!sessionGuard.isCurrent(token)) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: resourceManagementKeys.directory() });
      // 等待目录刷新期间也可能换了会话
      if (!sessionGuard.isCurrent(token)) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: resourceManagementKeys.pages() }),
        queryClient.invalidateQueries({ queryKey: resourceManagementKeys.details() })
      ]);
    }
  });
}

interface DetailSubmission {
  change: ResourceDetailChange;
  token: string | undefined;
}

/** 保存资源详情（分类与字段名称）；成功后刷新这个资源的详情和列表 */
export function useResourceDetailMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ change, token }: DetailSubmission) => {
      sessionGuard.assertCurrent(token);
      return saveResourceDetail(change);
    },
    onSuccess: async (_data, { change, token }) => {
      if (sessionGuard.isCurrent(token)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.detail(change.id) }),
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.pages() })
        ]);
      }
    }
  });
}

interface StatusSubmission {
  id: string;
  enabled: boolean;
  token: string | undefined;
}

/** 启用或停用图层，不同图层可以同时进行；成功后重新读取后端的状态，不原地修改列表缓存 */
export function useResourceStatusMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ id, enabled, token }: StatusSubmission) => {
      sessionGuard.assertCurrent(token);
      return setResourceStatus(id, enabled);
    },
    onSuccess: async (_data, { id, token }) => {
      if (sessionGuard.isCurrent(token)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.pages() }),
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.detail(id) })
        ]);
      }
    }
  });
}

interface ImportSubmission {
  input: ResourceExcelImport;
  token: string | undefined;
  onProgress: (value: TransferProgress) => void;
}

/** 导入 Excel；请求不带图层 ID，影响哪些图层不知道，成功后刷新本模块全部列表、详情和年份 */
export function useResourceImportMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ input, token, onProgress }: ImportSubmission) => {
      sessionGuard.assertCurrent(token);
      return importResourceExcel(input, onProgress);
    },
    onSuccess: async (_data, { token }) => {
      if (sessionGuard.isCurrent(token)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.pages() }),
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.details() }),
          queryClient.invalidateQueries({ queryKey: resourceManagementKeys.years() })
        ]);
      }
    }
  });
}

export interface ApplicationSubmission {
  application: DataApplication;
  token: string | undefined;
}

/** 提交数据下载申请；本页没有申请列表，成功后不刷新缓存 */
export function useDataApplicationMutation() {
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ application, token }: ApplicationSubmission) => {
      sessionGuard.assertCurrent(token);
      return createDataApplication(application);
    }
  });
}
