import { useQuery } from '@tanstack/vue-query';
import { fetchResourceTree } from './api';
import { buildCatalog } from './catalog';

/** 资源图层的 query key 只在这里拼 */
export const resourceMapKeys = {
  all: ['resource-map'] as const,
  tree: () => [...resourceMapKeys.all, 'tree'] as const
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
