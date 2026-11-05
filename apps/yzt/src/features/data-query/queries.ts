import { hashKey, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue';
import { fetchResultFeatures, fetchResultPage, type PageParams, type QueryRequest, type ResultPage } from './api';

/** 结果表的参数：查询加上页码；没有查询时不请求 */
export interface ResultPageParams extends PageParams {
  readonly request: QueryRequest | null;
}

/** 数据查询的 query key 只在这里拼 */
export const dataQueryKeys = {
  all: ['data-query'] as const,
  page: (params: ResultPageParams) => [...dataQueryKeys.all, 'page', params] as const,
  features: (request: QueryRequest | null) => [...dataQueryKeys.all, 'features', request] as const
};

const sameRequest = (a: QueryRequest | null, b: QueryRequest | null) => hashKey([a]) === hashKey([b]);

/** 结果表的一页（交给 usePagedList）：同一次查询翻页时保留上一页，换了查询不保留（不同图层的列不同） */
export function useResultPageQuery(params: ComputedRef<ResultPageParams>) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: computed(() => dataQueryKeys.page(params.value)),
    // 参数从 key 里取，请求用的参数和缓存的 key 一定一致；没有查询时 enabled 为 false，不会调用
    queryFn: ({ queryKey: [, , page], signal }) => {
      if (page.request === null) {
        throw new Error('没有查询时不请求结果');
      }
      return fetchResultPage(page.request, page, signal);
    },
    enabled: computed(() => params.value.request !== null),
    placeholderData: (previous, previousQuery) =>
      previousQuery && sameRequest(previousQuery.queryKey[2].request, params.value.request) ? previous : undefined
  });

  function rememberPage(pageParams: ResultPageParams, page: ResultPage) {
    queryClient.setQueryData(dataQueryKeys.page(pageParams), page);
  }

  return { ...query, rememberPage };
}

/** 空间查询命中的全部要素，画在地图上；属性类的查询不请求 */
export function useResultFeaturesQuery(request: MaybeRefOrGetter<QueryRequest | null>) {
  return useQuery({
    queryKey: computed(() => dataQueryKeys.features(toValue(request))),
    queryFn: ({ queryKey: [, , current], signal }) => {
      if (current === null || current.kind === 'attribute') {
        throw new Error('属性类的查询不请求要素');
      }
      return fetchResultFeatures(current, signal);
    },
    enabled: computed(() => {
      const current = toValue(request);
      return current !== null && current.kind !== 'attribute';
    })
  });
}
