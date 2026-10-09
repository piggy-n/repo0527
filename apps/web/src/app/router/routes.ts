import type { RouteRecordRaw } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { RouteName } from '@/shared/router/route-names';
import { AppLayout } from '../layout/AppLayout';

const loadPlaceholder = () =>
  import('@/pages/placeholder/PlaceholderPage').then(({ PlaceholderPage }) => PlaceholderPage);

// 地图页加载前先完成地图运行时的全局设置；两者都是动态导入，maplibre-gl 不会进入入口包
const withMapRuntime =
  <T>(loadPage: () => Promise<T>) =>
  async (): Promise<T> => {
    const { setupMapRuntime } = await import('../map-runtime');
    setupMapRuntime();
    return loadPage();
  };

// 尚未迁移的业务页，迁移后换成指向真实页面的完整路由记录；roles 不写时所有已登录用户都能访问
const placeholder = (path: string, name: RouteName, title: string, roles?: readonly Role[]): RouteRecordRaw => ({
  path,
  name,
  component: loadPlaceholder,
  meta: { title, roles }
});

// 地址和各角色能访问的页面沿用旧项目
const businessRoutes: RouteRecordRaw[] = [
  placeholder('current-map', RouteName.currentMap, '现状底图'),
  placeholder('land-change-query', RouteName.landChangeQuery, '国土变更调查查询'),
  placeholder('space-monitoring-query', RouteName.spaceMonitoringQuery, '城市国土空间监测查询'),
  placeholder('forest-grass-wetland-desert-query', RouteName.forestGrassWetlandDesertQuery, '森林草原湿地荒漠调查监测'),
  placeholder('water-resource-basic-query', RouteName.waterResourceBasicQuery, '水资源基础调查'),
  placeholder('space-monitoring-basic-statistics', RouteName.spaceMonitoringBasicStatistics, '城市国土空间监测基本统计'),
  placeholder('space-monitoring-indicators', RouteName.spaceMonitoringIndicators, '城市国土空间监测指标'),
  {
    path: 'file-management',
    name: RouteName.fileManagement,
    component: () =>
      import('@/pages/file-management/FileManagementPage').then(({ FileManagementPage }) => FileManagementPage),
    meta: { title: '文件管理' }
  },
  placeholder('ai-chat', RouteName.aiChat, 'AI对话'),
  placeholder('message-center', RouteName.messageCenter, '消息中心'),
  placeholder('resource-management', RouteName.resourceManagement, '资源管理', [Role.admin]),
  placeholder('resource-application', RouteName.resourceApplication, '资源申请', [Role.user]),
  placeholder('system-management', RouteName.systemManagement, '系统管理', [Role.admin])
];

// 开发页面：放在 pages/dev/<名称>/，路由名 dev<名称>，路径 /dev/<名称>（AGENTS.md）
// 生产构建中 import.meta.env.DEV 为 false，这些路由连同页面代码都不会进入产物
const devRoutes: RouteRecordRaw[] = [
  {
    path: '/dev/theme',
    name: RouteName.devTheme,
    component: () => import('@/pages/dev/theme/DevThemePage').then(({ DevThemePage }) => DevThemePage),
    meta: { title: '主题预览', public: true }
  },
  {
    path: '/dev/map',
    name: RouteName.devMap,
    component: withMapRuntime(() => import('@/pages/dev/map/DevMapPage').then(({ DevMapPage }) => DevMapPage)),
    meta: { title: '地图开发页', public: true }
  }
];

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: RouteName.login,
    component: () => import('@/pages/login/LoginPage').then(({ LoginPage }) => LoginPage),
    meta: { title: '登录', public: true }
  },
  {
    path: '/',
    component: AppLayout,
    children: [{ path: '', name: RouteName.home, redirect: { name: RouteName.currentMap } }, ...businessRoutes]
  },
  ...(import.meta.env.DEV ? devRoutes : []),
  {
    path: '/:pathMatch(.*)*',
    name: RouteName.notFound,
    component: () => import('@/pages/not-found/NotFoundPage').then(({ NotFoundPage }) => NotFoundPage),
    meta: { title: '页面不存在', public: true }
  }
];
