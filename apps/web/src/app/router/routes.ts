import type { RouteRecordRaw } from 'vue-router';
import { RouteName } from '@/shared/router/route-names';
import { AppLayout } from '../layout/AppLayout';

const loadPlaceholder = () =>
  import('@/pages/placeholder/PlaceholderPage').then(({ PlaceholderPage }) => PlaceholderPage);

// 尚未迁移的业务页，迁移后换成指向真实页面的完整路由记录
const placeholder = (path: string, name: RouteName, title: string): RouteRecordRaw => ({
  path,
  name,
  component: loadPlaceholder,
  meta: { title }
});

// 地址沿用旧项目
const businessRoutes: RouteRecordRaw[] = [
  placeholder('current-map', RouteName.currentMap, '现状底图'),
  placeholder('land-change-query', RouteName.landChangeQuery, '国土变更调查查询'),
  placeholder('space-monitoring-query', RouteName.spaceMonitoringQuery, '城市国土空间监测查询'),
  placeholder('forest-grass-wetland-desert-query', RouteName.forestGrassWetlandDesertQuery, '森林草原湿地荒漠调查监测'),
  placeholder('water-resource-basic-query', RouteName.waterResourceBasicQuery, '水资源基础调查'),
  placeholder('space-monitoring-basic-statistics', RouteName.spaceMonitoringBasicStatistics, '城市国土空间监测基本统计'),
  placeholder('space-monitoring-indicators', RouteName.spaceMonitoringIndicators, '城市国土空间监测指标'),
  placeholder('file-management', RouteName.fileManagement, '文件管理'),
  placeholder('ai-chat', RouteName.aiChat, 'AI对话'),
  placeholder('message-center', RouteName.messageCenter, '消息中心'),
  placeholder('resource-management', RouteName.resourceManagement, '资源管理'),
  placeholder('resource-application', RouteName.resourceApplication, '资源申请'),
  placeholder('system-management', RouteName.systemManagement, '系统管理')
];

// 生产构建中 import.meta.env.DEV 为 false，这些路由连同页面代码都不会进入产物
const devRoutes: RouteRecordRaw[] = [
  {
    path: '/dev/theme',
    name: RouteName.themePreview,
    component: () => import('@/pages/theme-preview/ThemePreviewPage').then(({ ThemePreviewPage }) => ThemePreviewPage),
    meta: { title: '主题预览' }
  }
];

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: RouteName.login,
    component: () => import('@/pages/login/LoginPage').then(({ LoginPage }) => LoginPage),
    meta: { title: '登录' }
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
    meta: { title: '页面不存在' }
  }
];
