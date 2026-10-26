import type { Component } from 'vue';
import { loginToMap } from '@/shared/perf/login-to-map';

/** 地图框架：二维是 MapLibre，三维是 Cesium（ADR 0061 第 1 节、ADR 0079 第 2 节） */
export type MapFramework = '2d' | '3d';

/** 进入地图时先用哪个框架；现在固定是二维，三维在第一次切换时才加载（ADR 0079 第 2 节），以后按部署配置、用户配置或上次使用的框架回答 */
export function defaultMapFramework(): MapFramework {
  return '2d';
}

/** 一个框架的运行时：模块加载后先做全局设置，地图页分块也到了再预热 */
export interface MapRuntime {
  setup(): void;
  prewarm(): void;
}

// 各框架的运行时都是动态导入：maplibre-gl、cesium 不进入入口包（ADR 0019、0023、0079）
const RUNTIME_LOADERS: Readonly<Record<MapFramework, () => Promise<MapRuntime>>> = {
  '2d': () =>
    import('./map-runtime').then(({ setupMapRuntime, prewarmMapRuntime }) => ({
      setup: setupMapRuntime,
      prewarm: prewarmMapRuntime
    })),
  // Cesium 的 Worker 按需创建，没有可以提前建好的池
  '3d': () =>
    import('./map-runtime-3d').then(({ setupSceneRuntime }) => ({
      setup: setupSceneRuntime,
      prewarm: () => undefined
    }))
};

/** 加载框架的运行时，不做设置 */
export function loadMapRuntime(framework: MapFramework): Promise<MapRuntime> {
  return RUNTIME_LOADERS[framework]();
}

/** 加载框架的运行时并做好设置；地图页的画布第一次需要另一个框架时调用（ADR 0079 第 2 节）。重复调用时模块已在模块表里，设置也只做一次 */
export async function prepareMapRuntime(
  framework: MapFramework,
  load: (framework: MapFramework) => Promise<MapRuntime> = loadMapRuntime
): Promise<void> {
  const runtime = await load(framework);
  runtime.setup();
}

/**
 * 地图页的加载函数（ADR 0061 第 2 节）：同时加载默认框架的运行时和页面，都到了以后设置运行时、预热，再返回包了一层的页面
 * （页面里的画布从这一层取加载其他框架运行时的函数，ADR 0079 第 2 节）。
 * 路由和登录页的预加载共用它；页面模块执行时不创建地图，所以设置放在页面加载之后也来得及
 */
export function withMapRuntime(
  loadPage: () => Promise<Component>,
  loadRuntime: () => Promise<MapRuntime> = () => loadMapRuntime(defaultMapFramework())
): () => Promise<Component> {
  return async () => {
    const [runtime, page, { withRuntimeLoader }] = await Promise.all([
      loadRuntime(),
      loadPage(),
      import('./map-runtime-provider')
    ]);
    runtime.setup();
    // 两个分块都下完再预热：Worker 脚本不和它们抢带宽（实验里提前预热让 Slow 4G 的视图就绪晚了 0.8 秒）
    runtime.prewarm();
    loginToMap.mark('runtime');
    return withRuntimeLoader(page, framework => prepareMapRuntime(framework));
  };
}
