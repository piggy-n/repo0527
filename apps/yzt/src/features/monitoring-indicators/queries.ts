import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { IndicatorApi, IndicatorTreeParams, IndicatorTreeSource } from './api';
import type { IndicatorTreeNode } from './indicator-tree';
import type { IndicatorResult } from './result-layers';

/** 指标页的 query key 只在这里拼 */
export const indicatorKeys = {
  all: ['monitoring-indicators'] as const,
  tree: (source: IndicatorTreeSource, params: IndicatorTreeParams | null) =>
    [...indicatorKeys.all, 'tree', source, params?.category, params?.regionCode, params?.year] as const,
  result: (id: string | null) => [...indicatorKeys.all, 'result', id] as const
};

/** 一棵指标树和它所属的条件：换条件后 data 要到下一轮调度才换成新的，用 params 判断是不是当前条件的 */
export interface IndicatorTreeData {
  readonly params: IndicatorTreeParams;
  readonly nodes: readonly IndicatorTreeNode[];
}

/**
 * 指标树：年份和监测范围都有时才请求（条件不全时拿到的不是当前条件的结果）。
 * 换条件、换页签时先显示上一棵树，新的到了再替换，不闪成空的
 */
export function useIndicatorTreeQuery(
  api: IndicatorApi,
  source: IndicatorTreeSource,
  params: () => IndicatorTreeParams | null
) {
  return useQuery({
    queryKey: computed(() => indicatorKeys.tree(source, params())),
    queryFn: async ({ signal }): Promise<IndicatorTreeData> => {
      const current = params();
      if (current === null) {
        throw new Error('条件不全时不请求指标树');
      }
      return { params: current, nodes: await api.fetchTree(source, current, signal) };
    },
    enabled: computed(() => params() !== null),
    placeholderData: keepPreviousData
  });
}

/** 一个指标的成果和它的记录 ID，用 id 判断是不是当前选中的指标的 */
export interface IndicatorResultData {
  readonly id: string;
  readonly result: IndicatorResult;
}

/** 一个指标的成果；id 为 null 时不请求 */
export function useIndicatorResultQuery(api: IndicatorApi, id: () => string | null) {
  return useQuery({
    queryKey: computed(() => indicatorKeys.result(id())),
    queryFn: async ({ signal }): Promise<IndicatorResultData> => {
      const current = id();
      if (current === null) {
        throw new Error('没有选择指标时不请求成果');
      }
      return { id: current, result: await api.fetchResult(current, signal) };
    },
    enabled: computed(() => id() !== null)
  });
}
