import { QueryClient } from '@tanstack/vue-query';

/** 接口数据的缓存，全局配置的理由见 ADR 0017 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // http 每次请求失败都会弹全局提示，失败重试会让一次失败提示多次
      retry: false,
      // 管理类列表不需要切回标签页时自动刷新，也避免后端出错时突然弹出提示
      refetchOnWindowFocus: false
    }
  }
});
