import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router';
import type { TopicId } from '@/features/data-query/topics';
import { Role } from '@/shared/auth/roles';
import { RouteName } from '@/shared/router/route-names';
import { AppLayout } from '../layout/AppLayout';
import { withMapRuntime } from '../map-framework';

const loadPlaceholder = () =>
  import('@/pages/placeholder/PlaceholderPage').then(({ PlaceholderPage }) => PlaceholderPage);

// 系统管理的两个栏目是两个路由、同一个页面，栏目由 props 传入；打开的申请是资源审核的查询参数 apply（ADR 0092）
const loadSystemManagementPage = () =>
  import('@/pages/system-management/SystemManagementPage').then(({ SystemManagementPage }) => SystemManagementPage);

/** 资源审核路由的 props：栏目和打开的申请 */
export const auditRouteProps = (route: Pick<RouteLocationNormalized, 'query'>) => ({
  section: 'audit',
  // 空字符串和同名参数写了几次（数组）都不认
  applyId: typeof route.query.apply === 'string' && route.query.apply !== '' ? route.query.apply : null
});

/** 现状底图的加载函数：路由和登录页的预加载共用（ADR 0061 第 3 节） */
export const loadCurrentMapPage = withMapRuntime(() =>
  import('@/pages/current-map/CurrentMapPage').then(({ CurrentMapPage }) => CurrentMapPage)
);

// 尚未迁移的业务页，迁移后换成指向真实页面的完整路由记录；roles 不写时所有已登录用户都能访问
const placeholder = (path: string, name: RouteName, title: string, roles?: readonly Role[]): RouteRecordRaw => ({
  path,
  name,
  component: loadPlaceholder,
  meta: { title, roles }
});

// 数据查询的四个页面共用一个组件，专题由 props 传入；换专题时页面按专题重建（DataQueryPage）
const loadDataQueryPage = withMapRuntime(() =>
  import('@/pages/data-query/DataQueryPage').then(({ DataQueryPage }) => DataQueryPage)
);

const dataQueryRoute = (path: string, name: RouteName, topic: TopicId, title: string): RouteRecordRaw => ({
  path,
  name,
  component: loadDataQueryPage,
  props: { topic },
  meta: { title }
});

// 地址和各角色能访问的页面沿用旧项目
const businessRoutes: RouteRecordRaw[] = [
  {
    path: 'current-map',
    name: RouteName.currentMap,
    component: loadCurrentMapPage,
    meta: { title: '现状底图', keepAlive: true }
  },
  dataQueryRoute('land-change-query', RouteName.landChangeQuery, 'land-change', '国土变更调查查询'),
  dataQueryRoute('space-monitoring-query', RouteName.spaceMonitoringQuery, 'space-monitoring', '城市国土空间监测查询'),
  dataQueryRoute(
    'forest-grass-wetland-desert-query',
    RouteName.forestGrassWetlandDesertQuery,
    'forest-grass-wetland-desert',
    '森林草原湿地荒漠调查监测'
  ),
  dataQueryRoute('water-resource-basic-query', RouteName.waterResourceBasicQuery, 'water-resource', '水资源基础调查'),
  {
    path: 'space-monitoring-basic-statistics',
    name: RouteName.spaceMonitoringBasicStatistics,
    component: () =>
      import('@/pages/space-monitoring-statistics/SpaceMonitoringStatisticsPage').then(
        ({ SpaceMonitoringStatisticsPage }) => SpaceMonitoringStatisticsPage
      ),
    meta: { title: '城市国土空间监测基本统计' }
  },
  {
    path: 'space-monitoring-indicators',
    name: RouteName.spaceMonitoringIndicators,
    component: withMapRuntime(() =>
      import('@/pages/space-monitoring-indicators/SpaceMonitoringIndicatorsPage').then(
        ({ SpaceMonitoringIndicatorsPage }) => SpaceMonitoringIndicatorsPage
      )
    ),
    meta: { title: '城市国土空间监测指标' }
  },
  {
    path: 'file-management',
    name: RouteName.fileManagement,
    component: () =>
      import('@/pages/file-management/FileManagementPage').then(({ FileManagementPage }) => FileManagementPage),
    meta: { title: '文件管理' }
  },
  {
    path: 'ai-chat',
    name: RouteName.aiChat,
    component: withMapRuntime(() => import('@/pages/ai-chat/AiChatPage').then(({ AiChatPage }) => AiChatPage)),
    meta: { title: 'AI对话' }
  },
  // 切到别的页面再回来，推演和结果都还在；停用期间推演暂停（ADR 0105 第 9 条）
  {
    path: 'indicator-simulation',
    name: RouteName.indicatorSimulation,
    component: withMapRuntime(() =>
      import('@/pages/indicator-simulation/IndicatorSimulationPage').then(
        ({ IndicatorSimulationPage }) => IndicatorSimulationPage
      )
    ),
    meta: { title: '指标智能推演', keepAlive: true }
  },
  {
    path: 'resource-management',
    name: RouteName.resourceManagement,
    component: () =>
      import('@/pages/resource-management/ResourceManagementPage').then(
        ({ ResourceManagementPage }) => ResourceManagementPage
      ),
    meta: { title: '资源管理', roles: [Role.admin] }
  },
  placeholder('resource-application', RouteName.resourceApplication, '资源申请', [Role.user]),
  {
    path: 'system-management',
    name: RouteName.systemManagement,
    component: loadSystemManagementPage,
    props: auditRouteProps,
    meta: { title: '系统管理', roles: [Role.admin] }
  },
  {
    path: 'system-management/statistical-report',
    name: RouteName.systemManagementReports,
    component: loadSystemManagementPage,
    props: { section: 'reports' },
    meta: { title: '统计报表', roles: [Role.admin] }
  }
];

// 开发页面：放在 pages/dev/<名称>/，路由名 dev<名称>，路径 /dev/<名称>（AGENTS.md）
// 生产构建中 import.meta.env.DEV 为 false，这些路由连同页面代码都不会进入产物
const devRoutes: RouteRecordRaw[] = import.meta.env.DEV ? [
  {
    path: '/dev/file-management',
    name: RouteName.devFileManagement,
    component: () => import('@/pages/dev/file-management/DevFileManagementPage')
      .then(({ DevFileManagementPage }) => DevFileManagementPage),
    meta: { title: '文件管理组件样例', public: true }
  },
  {
    path: '/dev/resource-management',
    name: RouteName.devResourceManagement,
    component: () => import('@/pages/dev/resource-management/DevResourceManagementPage')
      .then(({ DevResourceManagementPage }) => DevResourceManagementPage),
    meta: { title: '资源管理组件样例', public: true }
  },
  {
    path: '/dev/system-management',
    name: RouteName.devSystemManagement,
    component: () => import('@/pages/dev/system-management/DevSystemManagementPage')
      .then(({ DevSystemManagementPage }) => DevSystemManagementPage),
    meta: { title: '系统管理组件样例', public: true }
  },
  {
    path: '/dev/message-center',
    name: RouteName.devMessageCenter,
    component: () => import('@/pages/dev/message-center/DevMessageCenterPage')
      .then(({ DevMessageCenterPage }) => DevMessageCenterPage),
    meta: { title: '消息组件样例', public: true }
  },
  {
    path: '/dev/monitoring-statistics',
    name: RouteName.devMonitoringStatistics,
    component: () =>
      import('@/pages/dev/monitoring-statistics/DevMonitoringStatisticsPage').then(
        ({ DevMonitoringStatisticsPage }) => DevMonitoringStatisticsPage
      ),
    meta: { title: '基本统计组件样例', public: true }
  },
  {
    path: '/dev/indicator-simulation',
    name: RouteName.devIndicatorSimulation,
    component: withMapRuntime(() =>
      import('@/pages/dev/indicator-simulation/DevIndicatorSimulationPage').then(
        ({ DevIndicatorSimulationPage }) => DevIndicatorSimulationPage
      )
    ),
    meta: { title: '指标智能推演组件样例', public: true }
  },
  {
    path: '/dev/monitoring-indicators',
    name: RouteName.devMonitoringIndicators,
    component: withMapRuntime(() =>
      import('@/pages/dev/monitoring-indicators/DevMonitoringIndicatorsPage').then(
        ({ DevMonitoringIndicatorsPage }) => DevMonitoringIndicatorsPage
      )
    ),
    meta: { title: '监测指标组件样例', public: true }
  },
  {
    path: '/dev/data-query',
    name: RouteName.devDataQuery,
    component: withMapRuntime(() =>
      import('@/pages/dev/data-query/DevDataQueryPage').then(({ DevDataQueryPage }) => DevDataQueryPage)
    ),
    meta: { title: '数据查询实测', public: true }
  },
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
  },
  {
    path: '/dev/map-ui',
    name: RouteName.devMapUi,
    component: () => import('@/pages/dev/map-ui/DevMapUiPage').then(({ DevMapUiPage }) => DevMapUiPage),
    meta: { title: '地图界面交互样例', public: true }
  },
  {
    path: '/dev/map-3d',
    name: RouteName.devMap3d,
    component: () => import('@/pages/dev/map-3d/DevMap3dPage').then(({ DevMap3dPage }) => DevMap3dPage),
    meta: { title: '三维迁移交互原型', public: true }
  },
  {
    path: '/dev/nav-grid',
    name: RouteName.devNavGrid,
    component: () => import('@/pages/dev/nav-grid/DevNavGridPage').then(({ DevNavGridPage }) => DevNavGridPage),
    meta: { title: '导航网格实测', public: true }
  },
  {
    path: '/dev/resources',
    name: RouteName.devResources,
    component: withMapRuntime(() =>
      import('@/pages/dev/resources/DevResourcesPage').then(({ DevResourcesPage }) => DevResourcesPage)
    ),
    meta: { title: '资源图层实测', public: true }
  }
] : [];

export const routes: RouteRecordRaw[] = [
  {
    path: '/city-dashboard',
    name: RouteName.cityDashboard,
    component: () =>
      import('@/pages/city-dashboard/CityDashboardPage').then(({ CityDashboardPage }) => CityDashboardPage),
    meta: { title: '城市体检驾驶舱' }
  },
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
  ...devRoutes,
  {
    path: '/:pathMatch(.*)*',
    name: RouteName.notFound,
    component: () => import('@/pages/not-found/NotFoundPage').then(({ NotFoundPage }) => NotFoundPage),
    meta: { title: '页面不存在', public: true }
  }
];
