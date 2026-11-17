import type { Component } from 'vue';
import { appConfig, type TiandituConfig } from '@/shared/config/app-config';
import { NO_SERVER_BASEMAPS, type ServerBasemaps } from '@/shared/map/basemap/server-basemaps';
import { loginToMap } from '@/shared/perf/login-to-map';
import { preloadRuntimeWhenIdle } from './map-preload';

/** 地图的运行时（MapLibre，二三维共用，ADR 0147）：模块加载后先做全局设置，地图页分块也到了再预热 */
export interface MapRuntime {
  setup(): void;
  prewarm(): void;
}

/** 加载运行时，不做设置；动态导入，maplibre-gl 不进入口包（ADR 0019、0023） */
export function loadMapRuntime(): Promise<MapRuntime> {
  return import('./map-runtime').then(({ setupMapRuntime, prewarmMapRuntime }) => ({
    setup: setupMapRuntime,
    prewarm: prewarmMapRuntime
  }));
}

// 只用到探测函数；整个模块是动态导入的分块
type ServerBasemapProbeModule = Pick<typeof import('@/shared/map/basemap/server-basemap-probe'), 'probeServerBasemaps'>;

/**
 * 探测这台服务器有哪些服务器底图（ADR 0165 第 4 节）：公网构建不探测，也不加载探测的分块。
 * 探测导入 map-core 的读取器，所以动态导入，maplibre-gl 不进入口包。不拒绝：分块加载失败也按没有
 */
export function loadServerBasemaps(
  tianditu: TiandituConfig | null = appConfig.tianditu,
  loadProbe: () => Promise<ServerBasemapProbeModule> = () => import('@/shared/map/basemap/server-basemap-probe')
): Promise<ServerBasemaps> {
  if (tianditu) {
    return Promise.resolve(NO_SERVER_BASEMAPS);
  }
  return loadProbe().then(
    ({ probeServerBasemaps }) => probeServerBasemaps(),
    (error: unknown) => {
      console.warn('[basemap] 探测服务器底图的模块加载失败，这次浏览没有服务器底图', error);
      return NO_SERVER_BASEMAPS;
    }
  );
}

let pageServerBasemaps: Promise<ServerBasemaps> | undefined;

/** 整个文档探测一次，各地图页和登录页的预加载共用结果；服务器挂住时这次浏览就没有服务器底图，刷新重试 */
export function serverBasemapsOnce(): Promise<ServerBasemaps> {
  pageServerBasemaps ??= loadServerBasemaps();
  return pageServerBasemaps;
}

/**
 * 地图页的加载函数（ADR 0061 第 2 节）：同时加载运行时、页面和服务器底图的探测结果，都到了以后设置运行时、预热，
 * 再返回包了一层的页面（页面里的画布从这一层取预加载三维模块的函数和三维引擎，ADR 0079 第 2 节、ADR 0091；
 * 底图的拥有者从这一层取探测结果，ADR 0165 第 4 节）。
 * 路由和登录页的预加载共用它；页面模块执行时不创建地图，所以设置放在页面加载之后也来得及
 */
export function withMapRuntime(
  loadPage: () => Promise<Component>,
  loadRuntime: () => Promise<MapRuntime> = loadMapRuntime,
  loadServers: () => Promise<ServerBasemaps> = serverBasemapsOnce
): () => Promise<Component> {
  return async () => {
    const [runtime, page, { withRuntimeLoader }, servers] = await Promise.all([
      loadRuntime(),
      loadPage(),
      import('./map-runtime-provider'),
      loadServers()
    ]);
    runtime.setup();
    // 两个分块都下完再预热：Worker 脚本不和它们抢带宽（实验里提前预热让 Slow 4G 的视图就绪晚了 0.8 秒）
    runtime.prewarm();
    loginToMap.mark('runtime');
    // 画布交来要预加载的内容（MapLibre 引擎的三维模块），这里只决定时机
    return withRuntimeLoader(page, load => preloadRuntimeWhenIdle(load), servers);
  };
}
