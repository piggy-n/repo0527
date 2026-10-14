import { skipToken, useQuery } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { type FeatureDetail, fetchFeatureDetail, fetchResourceTree } from './api';
import { buildCatalog } from './catalog';

/** 资源图层的 query key 只在这里拼 */
export const resourceMapKeys = {
  all: ['resource-map'] as const,
  tree: () => [...resourceMapKeys.all, 'tree'] as const,
  featureDetail: (layerCode: string, guid: string) => [...resourceMapKeys.all, 'feature', layerCode, guid] as const
};

/**
 * 资源目录：查询缓存保存接口树，`select` 由它得出目录。树的引用不变时不重新得出，
 * 后台刷新的内容没变时，结构共享会保留原来的树，面板、图例、拥有者拿到的还是同一个目录
 */
export function useResourceCatalogQuery() {
  return useQuery({
    queryKey: resourceMapKeys.tree(),
    queryFn: ({ signal }) => fetchResourceTree(signal),
    select: buildCatalog
  });
}

/** 要查详情的要素：图层编码是"资源编码_年份" */
export interface FeatureKey {
  readonly layerCode: string;
  readonly guid: string;
}

/** 查询结果带着它属于哪个要素 */
export interface FeatureDetailEntry {
  readonly feature: FeatureKey;
  readonly detail: FeatureDetail;
}

/**
 * 要素的详情（ADR 0047 第 3 节）：按图层编码和 guid 缓存；为 null 时不查询。换了要素时上一个请求没有别的使用者，
 * 查询缓存会取消它。换了要素后结果要到下一轮调度才换成新要素的，期间 data 仍是上一个要素的，用 feature 区分
 */
export function useFeatureDetailQuery(feature: MaybeRefOrGetter<FeatureKey | null>) {
  return useQuery(
    computed(() => {
      const key = toValue(feature);
      const queryFn = key
        ? ({ signal }: { signal: AbortSignal }) => fetchFeatureDetail(key.layerCode, key.guid, signal)
        : skipToken;
      return {
        queryKey: resourceMapKeys.featureDetail(key?.layerCode ?? '', key?.guid ?? ''),
        queryFn,
        // 缓存里只存详情，读出时标上要素
        select: (detail: FeatureDetail): FeatureDetailEntry => ({ feature: key ?? { layerCode: '', guid: '' }, detail })
      };
    })
  );
}
