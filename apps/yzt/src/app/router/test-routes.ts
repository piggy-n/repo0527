import type { RouteRecordRaw } from 'vue-router';
import { routes } from './routes';

const Empty = { render: () => null };

function withoutPages(records: readonly RouteRecordRaw[]): RouteRecordRaw[] {
  return records.map(
    record =>
      ({
        ...record,
        ...(record.component ? { component: Empty } : {}),
        ...(record.children ? { children: withoutPages(record.children) } : {})
      }) as RouteRecordRaw
  );
}

/**
 * 只供测试：真实的路由表，页面换成空组件。顶栏只用路由的名称和 meta，导航时不加载页面分块
 * （地图页会预热 Worker 池，jsdom 里没有 Worker）
 */
export const routesWithoutPages = () => withoutPages(routes);
