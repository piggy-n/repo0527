import { LoadTrace } from './load-trace';

/** 依次是：三维视图就绪（同一个视图换成三维、三维模块 map-three 也加载好）、第一次画面稳定 */
export const SWITCH_TO_3D_STEPS = ['view-ready', 'settled'] as const;

export type SwitchTo3dStep = (typeof SWITCH_TO_3D_STEPS)[number];

/** 切到三维（docs/modules/perf.md）：点了"三维"时开始；第一次切换要加载三维模块，之后一直留着 */
export const switchTo3d = new LoadTrace('switch-to-3d', SWITCH_TO_3D_STEPS);
