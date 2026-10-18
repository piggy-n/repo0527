import { loginToMap } from '@/shared/perf/login-to-map';

/** 地图框架：三维运行时按需加载，首期仍默认二维（ADR 0064） */
export type MapFramework = '2d' | '3d';

/** 进入地图时先用哪个框架；现在固定是二维，三维阶段按部署配置、用户配置或上次使用的框架回答 */
export function defaultMapFramework(): MapFramework {
  return '2d';
}

/** 一个框架的运行时：模块加载后先做全局设置，地图页分块也到了再预热 */
export interface MapRuntime {
  setup(): void;
  prewarm?(): void;
}

// 各框架的运行时都是动态导入：maplibre-gl 不进入入口包（ADR 0019、0023）
const RUNTIME_LOADERS: Readonly<Record<MapFramework, () => Promise<MapRuntime>>> = {
  '2d': () =>
    import('./map-runtime').then(({ setupMapRuntime, prewarmMapRuntime }) => ({
      setup: setupMapRuntime,
      prewarm: prewarmMapRuntime
    })),
  '3d': () => import('./cesium-runtime').then(({ setupCesiumRuntime }) => ({ setup: setupCesiumRuntime }))
};

/** 加载框架的运行时，不做设置 */
export function loadMapRuntime(framework: MapFramework): Promise<MapRuntime> {
  return RUNTIME_LOADERS[framework]();
}

/**
 * 地图页的加载函数（ADR 0061 第 2 节）：同时加载默认框架的运行时和页面，都到了以后设置运行时、预热，再返回页面。
 * 路由和登录页的预加载共用它；页面模块执行时不创建地图，所以设置放在页面加载之后也来得及
 */
export function withMapRuntime<T>(
  loadPage: () => Promise<T>,
  loadRuntime: () => Promise<MapRuntime> = () => loadMapRuntime(defaultMapFramework())
): () => Promise<T> {
  return async () => {
    const [runtime, page] = await Promise.all([loadRuntime(), loadPage()]);
    runtime.setup();
    // 两个分块都下完再预热：Worker 脚本不和它们抢带宽（实验里提前预热让 Slow 4G 的视图就绪晚了 0.8 秒）
    runtime.prewarm?.();
    loginToMap.mark('runtime');
    return page;
  };
}
