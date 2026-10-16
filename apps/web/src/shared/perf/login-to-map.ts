import { LoadTrace } from './load-trace';

/** 依次是：登录接口返回、地图运行时（maplibre-gl）加载完成、地图页开始创建、视图就绪（样式加载完成）、第一次画面稳定 */
export const LOGIN_TO_MAP_STEPS = ['session', 'runtime', 'page', 'view-ready', 'settled'] as const;

export type LoginToMapStep = (typeof LOGIN_TO_MAP_STEPS)[number];

/** 登录到地图第一次加载完成（docs/modules/perf.md）：校验通过、发出登录请求时开始 */
export const loginToMap = new LoadTrace('login-to-map', LOGIN_TO_MAP_STEPS);
