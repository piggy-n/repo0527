import type { InjectionKey } from 'vue';
import type { ServerBasemapId } from '../../config/server-basemap-options';

// 探测结果的类型和注入键：入口包里的 app/map-framework 也导入它，这里不导入 map-core 等有分量的模块

/** 这台服务器上探测到的一套底图（ADR 0165 第 4 节） */
export interface ServerBasemap {
  readonly id: ServerBasemapId;
  /** 缓存 `Layers/` 目录的绝对地址，以 / 结尾：数据源的瓦片地址模板由它得出 */
  readonly root: string;
  /** 探测时读到的那块瓦片做成的 data URL，就是缩略图 */
  readonly thumbnail: string;
}

/** 探测结果：这台服务器有的服务器底图，按 SERVER_BASEMAP_OPTIONS 的顺序，没有的不在里面 */
export type ServerBasemaps = readonly ServerBasemap[];

/** 没有服务器底图：公网、探测失败、没有注入时（测试、开发页） */
export const NO_SERVER_BASEMAPS: ServerBasemaps = Object.freeze([]);

/** 地图页的加载函数探测一次，由 app 提供给页面，useBasemap 注入（ADR 0165 第 4 节） */
export const SERVER_BASEMAPS: InjectionKey<ServerBasemaps> = Symbol('server-basemaps');
