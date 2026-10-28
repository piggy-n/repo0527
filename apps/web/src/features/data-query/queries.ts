import { skipToken, useQuery } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import { fetchQueryPage, fetchQueryShapes, type QueryPage, type QueryRecord, type QueryShapes } from './api';
import type { QuerySnapshot } from './types';

/** 数据查询的 query key 只在这里拼；快照身份每次查询都不同 */
export const dataQueryKeys = {
  all: ['data-query'] as const,
  page: (id: string, page: number) => [...dataQueryKeys.all, id, page] as const,
  shapes: (id: string) => [...dataQueryKeys.all, id, 'geometry'] as const,
  detail: (id: string, record: QueryRecord | null) => [...dataQueryKeys.all, id, 'detail', record] as const
};

/**
 * 查询缓存只持有服务端结果，表单与快照由拥有者管理。
 * 和其他读取一样不另外核对会话：会话结束时 endSession 清空缓存，进行中的读取随之取消
 */
export function useDataQueries(snapshot: Ref<QuerySnapshot | null>, page: Ref<number>) {
  const pageQuery = useQuery(computed(() => {
    const request = snapshot.value;
    const pageNumber = page.value;
    return {
      queryKey: dataQueryKeys.page(request?.id ?? '', pageNumber),
      queryFn: request
        ? ({ signal }: { signal: AbortSignal }) => fetchQueryPage(request, pageNumber, signal)
        : skipToken,
      gcTime: 0,
      // 缓存里只存结果，读出时标上属于哪次查询的哪一页
      select: (value: QueryPage) => ({ id: request?.id, page: pageNumber, value })
    };
  }));
  const shapesQuery = useQuery(computed(() => {
    const request = snapshot.value;
    return {
      queryKey: dataQueryKeys.shapes(request?.id ?? ''),
      // 按行政区查询时地图用筛选过的瓦片，不读取完整几何
      queryFn: request && request.scope.kind !== 'region'
        ? ({ signal }: { signal: AbortSignal }) => fetchQueryShapes(request, signal)
        : skipToken,
      gcTime: 0,
      select: (value: QueryShapes) => ({ id: request?.id, value })
    };
  }));
  const result = computed(() => {
    const data = pageQuery.data.value;
    return data?.id === snapshot.value?.id && data?.page === page.value ? data.value : undefined;
  });
  const shapes = computed(() => {
    const data = shapesQuery.data.value;
    return data?.id === snapshot.value?.id ? data?.value : undefined;
  });
  return { pageQuery, shapesQuery, result, shapes };
}
