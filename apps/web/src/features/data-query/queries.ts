import { useQuery } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { fetchQueryPage, fetchQueryShapes } from './api';
import type { QuerySnapshot } from './types';

/** 查询缓存只持有服务端结果，表单与快照由拥有者管理；新查询使用新身份 */
export function useDataQueries(snapshot: Ref<QuerySnapshot | null>, page: Ref<number>) {
  const session = useSessionStore();
  const guard = useSessionGuard();
  const pageQuery = useQuery(computed(() => {
    const request = snapshot.value;
    const pageNumber = page.value;
    const token = guard.capture();
    return {
      queryKey: ['data-query', session.user?.loginName, request?.id, pageNumber],
      enabled: request !== null && token !== undefined,
      gcTime: 0,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        guard.assertCurrent(token);
        const value = await fetchQueryPage(request!, pageNumber, signal);
        guard.assertCurrent(token);
        return value;
      },
      select: (value: Awaited<ReturnType<typeof fetchQueryPage>>) => ({ id: request!.id, page: pageNumber, value })
    };
  }));
  const shapesQuery = useQuery(computed(() => {
    const request = snapshot.value;
    const token = guard.capture();
    return {
      queryKey: ['data-query', session.user?.loginName, request?.id, 'geometry'],
      enabled: request !== null && request.scope.kind !== 'region' && token !== undefined,
      gcTime: 0,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        guard.assertCurrent(token);
        const value = await fetchQueryShapes(request!, signal);
        guard.assertCurrent(token);
        return value;
      },
      select: (value: Awaited<ReturnType<typeof fetchQueryShapes>>) => ({ id: request!.id, value })
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
