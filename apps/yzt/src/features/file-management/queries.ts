import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import type { TransferProgress } from '@/shared/http/client';
import { deleteFile, fetchFilePage, type FilePageParams, type FileUploadInput, uploadFiles } from './api';

/** 文件管理的 query key 只在这里拼，查询和失效共用，避免两边写得不一致 */
export const fileKeys = {
  all: ['files'] as const,
  pages: () => [...fileKeys.all, 'page'] as const,
  page: (params: FilePageParams) => [...fileKeys.pages(), params] as const
};

/** 某个分类下某一页的文件；同一分类内翻页、筛选时保留上一次的数据，换分类时不保留 */
export function useFilePageQuery(params: MaybeRefOrGetter<FilePageParams>) {
  return useQuery({
    queryKey: computed(() => fileKeys.page(toValue(params))),
    // 参数从 key 里取，请求用的参数和缓存的 key 一定一致
    queryFn: ({ queryKey: [, , page], signal }) => fetchFilePage(page, signal),
    // 不直接用 keepPreviousData：换分类时会短暂显示上一个分类的文件
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2].categoryId === toValue(params).categoryId ? previous : undefined
  });
}

/** 写操作的参数都带上提交时的会话（useSessionGuard 的 capture） */
interface DeleteSubmission {
  id: string;
  token: string | undefined;
}

/** 删除文件，成功后让所有分页缓存失效；不传 signal，请求发出后后端就会执行，组件卸载也不取消 */
export function useDeleteFileMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ id, token }: DeleteSubmission) => {
      // 从提交到真正发请求之间可能已换会话，不能用新会话的凭据删除
      sessionGuard.assertCurrent(token);
      return deleteFile(id);
    },
    // 旧会话的结果不刷新新会话的缓存
    onSuccess: (_data, { token }) =>
      sessionGuard.isCurrent(token) ? queryClient.invalidateQueries({ queryKey: fileKeys.pages() }) : undefined
  });
}

interface UploadSubmission {
  input: FileUploadInput;
  token: string | undefined;
  onProgress: (progress: TransferProgress) => void;
}

/** 上传一批文件；和删除一样不随页面销毁取消，晚到的成功只让原会话的列表失效 */
export function useUploadFilesMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ input, token, onProgress }: UploadSubmission) => {
      sessionGuard.assertCurrent(token);
      return uploadFiles(input, onProgress);
    },
    // 显式不重试：失败时可能已经部分写入，重发会产生重复文件，由用户核对列表后决定
    retry: false,
    onSuccess: (_data, { token }) =>
      sessionGuard.isCurrent(token) ? queryClient.invalidateQueries({ queryKey: fileKeys.pages() }) : undefined
  });
}
