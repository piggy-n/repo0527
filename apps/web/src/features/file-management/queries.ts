import { CancelledError, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSessionStore, type Session } from '@/shared/auth/session-store';
import type { TransferProgress } from '@/shared/http/client';
import { ApiError } from '@/shared/http/errors';
import { deleteFile, fetchFileContent, fetchFilePage, uploadFiles, type FilePageParams, type FileUploadInput } from './api';
import type { FileTransferTarget } from './file-types';

/** 文件管理的 query key 只在这里拼，查询和失效共用，避免两边写得不一致 */
export const fileKeys = {
  all: ['files'] as const,
  pages: () => [...fileKeys.all, 'page'] as const,
  content: (objectKey: string, requestId: string) => [...fileKeys.all, 'content', objectKey, requestId] as const,
  page: (params: FilePageParams) => [...fileKeys.pages(), params] as const
};

/** 手动读取的 Blob 不跨操作缓存；独立 key 让下载和预览各自取消，结束会话仍由 QueryClient 统一清理 */
export function useFileContentRequest() {
  const queryClient = useQueryClient();
  const session = useSessionStore();
  return async (file: FileTransferTarget, signal: AbortSignal, onProgress?: (progress: TransferProgress) => void) => {
    const sentSession = session.session;
    // 临时身份只用于隔离查询，不比较先后；getRandomValues 也可用于普通 HTTP 内网
    const requestId = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
    const queryKey = fileKeys.content(file.objectKey, requestId);
    try {
      return await queryClient.query({
        queryKey,
        queryFn: ({ signal: querySignal }) => {
          if (signal.aborted || !sentSession || session.session !== sentSession || !session.isActive()) {
            throw new ApiError({ kind: 'canceled', message: '文件读取已取消' });
          }
          return fetchFileContent(file, AbortSignal.any([signal, querySignal]), onProgress);
        },
        retry: false,
        // 手动操作离线时直接失败，不排队在恢复联网后悄悄开始下载
        networkMode: 'always',
        gcTime: 0
      });
    } catch (error) {
      if (error instanceof CancelledError) {
        throw new ApiError({ kind: 'canceled', message: '文件读取已取消' });
      }
      throw error;
    } finally {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  };
}

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

/** 删除文件，成功后让所有分页缓存失效；不传 signal，请求发出后后端就会执行，组件卸载也不取消 */
export function useDeleteFileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteFile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fileKeys.pages() })
  });
}

interface UploadSubmission {
  input: FileUploadInput;
  session: Session;
  onProgress: (progress: TransferProgress) => void;
}

/** 写操作不随页面销毁取消、不自动重试；晚到的成功只能使原会话的列表失效 */
export function useUploadFilesMutation() {
  const queryClient = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: (submission: UploadSubmission) => {
      // mutation 调度到真正发请求前可能已换会话，不能用新凭据发送旧草稿
      if (session.session !== submission.session) {
        throw new ApiError({ kind: 'canceled', message: '会话已变更' });
      }
      return uploadFiles(submission.input, submission.onProgress);
    },
    retry: false,
    onSuccess: (_data, submission) => {
      if (session.session === submission.session && session.isActive()) {
        return queryClient.invalidateQueries({ queryKey: fileKeys.pages() });
      }
      return undefined;
    }
  });
}
