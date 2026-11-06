import type { SceneRendererLoader, ViewKind } from '@mx/map-core';
import type { InjectionKey } from 'vue';

/**
 * 三维引擎的描述（ADR 0147 第 1 节），由 app 按 .env 选一个 provide：
 * cesium 由 CesiumCanvas 的独立视图承担三维，运行时经 MAP_RUNTIME 加载；
 * maplibre 由 MapCanvas 的同一个视图承担三维，第一次要加瓦片集时用 loadRenderer 加载 @mx/map-three
 */
export type SceneEngine =
  | { readonly kind: 'cesium' }
  | { readonly kind: 'maplibre'; readonly loadRenderer: SceneRendererLoader };

/** 现有的 Cesium 三维 */
export const CESIUM_ENGINE: SceneEngine = Object.freeze({ kind: 'cesium' });

/** MapLibre + Three.js（ADR 0147）：@mx/map-three 和 three 在第一次要加瓦片集时才下载 */
export const MAPLIBRE_ENGINE: SceneEngine = Object.freeze({
  kind: 'maplibre',
  loadRenderer: () => import('@mx/map-three').then(({ createSceneRenderer }) => createSceneRenderer)
});

/** app 用它 provide 三维引擎；没有 provide 时按 Cesium（页面和拥有者不知道用的是哪一种） */
export const MAP_SCENE_ENGINE: InjectionKey<SceneEngine> = Symbol('map-scene-engine');

/** 加载某个框架的运行时并做好全局设置（ADR 0079 第 2 节）：由 app 在地图页外面 provide，画布第一次需要时调用 */
export type MapRuntimeLoader = (framework: ViewKind) => Promise<void>;

/** app 用它 provide 加载运行时的函数；页面不知道运行时的存在（ADR 0061 第 1 节的运行时注入） */
export const MAP_RUNTIME: InjectionKey<MapRuntimeLoader> = Symbol('map-runtime');

/** 预加载某个框架的运行时：画布觉得是时候了就调用，不等结果；什么时候真的加载（空闲、省流量模式）由 app 决定（ADR 0091） */
export type MapRuntimePreloader = (framework: ViewKind) => void;

/** app 用它 provide 预加载运行时的函数；没有 provide 时画布不预加载 */
export const MAP_RUNTIME_PRELOAD: InjectionKey<MapRuntimePreloader> = Symbol('map-runtime-preload');

/** app 用它 provide 地图错误的报告器，处理鉴权这类 map-vue 不认识的事；页面传了 onError 时以页面的为准，都没有时打印到控制台 */
export const MAP_ERROR_REPORTER: InjectionKey<(error: unknown) => void> = Symbol('map-error-reporter');
