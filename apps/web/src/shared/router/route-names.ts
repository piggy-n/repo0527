/** 路由名：app 的路由表和 pages、features 的跳转共用这一份约定 */
export const RouteName = {
  home: 'home',
  login: 'login',
  notFound: 'not-found',
  devTheme: 'dev-theme',
  devMap: 'dev-map',
  currentMap: 'current-map',
  landChangeQuery: 'land-change-query',
  spaceMonitoringQuery: 'space-monitoring-query',
  forestGrassWetlandDesertQuery: 'forest-grass-wetland-desert-query',
  waterResourceBasicQuery: 'water-resource-basic-query',
  spaceMonitoringBasicStatistics: 'space-monitoring-basic-statistics',
  spaceMonitoringIndicators: 'space-monitoring-indicators',
  fileManagement: 'file-management',
  aiChat: 'ai-chat',
  messageCenter: 'message-center',
  resourceManagement: 'resource-management',
  resourceApplication: 'resource-application',
  systemManagement: 'system-management'
} as const;

export type RouteName = (typeof RouteName)[keyof typeof RouteName];
