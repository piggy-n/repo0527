import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { deleteFile, fetchFilePage, type FilePageParams } from './api';

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

/** 删除文件，成功后让所有分页缓存失效；不传 signal，请求发出后后端就会执行，组件卸载也不取消 */
export function useDeleteFileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteFile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fileKeys.pages() })
  });
}
