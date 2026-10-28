import type { ViewKind } from '@yzt/map-core';
import type { InjectionKey } from 'vue';

/** 加载某个框架的运行时并做好全局设置（ADR 0079 第 2 节）：由 app 在地图页外面 provide，画布第一次需要时调用 */
export type MapRuntimeLoader = (framework: ViewKind) => Promise<void>;

/** app 用它 provide 加载运行时的函数；页面不知道运行时的存在（ADR 0061 第 1 节的运行时注入） */
export const MAP_RUNTIME: InjectionKey<MapRuntimeLoader> = Symbol('map-runtime');

/** 预加载某个框架的运行时：画布觉得是时候了就调用，不等结果；什么时候真的加载（空闲、省流量模式）由 app 决定（ADR 0091） */
export type MapRuntimePreloader = (framework: ViewKind) => void;

/** app 用它 provide 预加载运行时的函数；没有 provide 时画布不预加载 */
export const MAP_RUNTIME_PRELOAD: InjectionKey<MapRuntimePreloader> = Symbol('map-runtime-preload');
