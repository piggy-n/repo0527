import type { SceneRendererLoader, ViewKind } from '@mx/map-core';
import type { InjectionKey } from 'vue';

/**
 * 三维引擎能做什么（ADR 0147 第 3 节、ADR 0020 第 4 节）：页面和拥有者按它和当前维度决定显示什么，不看用的是哪种引擎
 */
export interface SceneCapabilities {
  /** 三维里照常画二维样式的全部图层（矢量瓦片、花纹、注记），不只是镜像的 GeoJSON 覆盖物 */
  readonly styleLayers: boolean;
  /** 三维期间点/框选能识别：三维视图的渲染要素查询有结果 */
  readonly identify: boolean;
}

/**
 * 三维引擎的描述（ADR 0147 第 1 节），由 app 按 .env 选一个 provide：
 * cesium 由 CesiumCanvas 的独立视图承担三维，运行时经 MAP_RUNTIME 加载；
 * maplibre 由 MapCanvas 的同一个视图承担三维，第一次切到三维时用 loadRenderer 加载 @mx/map-three
 */
export type SceneEngine =
  | { readonly kind: 'cesium'; readonly capabilities: SceneCapabilities }
  | { readonly kind: 'maplibre'; readonly capabilities: SceneCapabilities; readonly loadRenderer: SceneRendererLoader };

/** 现有的 Cesium 三维：资源图层不在三维显示，三维期间不识别（ADR 0080 第 5 节） */
export const CESIUM_ENGINE: Extract<SceneEngine, { kind: 'cesium' }> = Object.freeze({
  kind: 'cesium',
  capabilities: Object.freeze({ styleLayers: false, identify: false })
});

/** MapLibre + Three.js（ADR 0147）：@mx/map-three 和 three 在预加载或第一次切到三维时才下载 */
export const MAPLIBRE_ENGINE: Extract<SceneEngine, { kind: 'maplibre' }> = Object.freeze({
  kind: 'maplibre',
  capabilities: Object.freeze({ styleLayers: true, identify: true }),
  loadRenderer: () => import('@mx/map-three').then(({ createSceneRenderer }) => createSceneRenderer)
});

/** app 用它 provide 三维引擎；没有 provide 时按 Cesium（页面和拥有者不知道用的是哪一种） */
export const MAP_SCENE_ENGINE: InjectionKey<SceneEngine> = Symbol('map-scene-engine');

/** 加载某个框架的运行时并做好全局设置（ADR 0079 第 2 节）：由 app 在地图页外面 provide，画布第一次需要时调用 */
export type MapRuntimeLoader = (framework: ViewKind) => Promise<void>;

/** app 用它 provide 加载运行时的函数；页面不知道运行时的存在（ADR 0061 第 1 节的运行时注入） */
export const MAP_RUNTIME: InjectionKey<MapRuntimeLoader> = Symbol('map-runtime');

/**
 * 预加载：画布觉得是时候了就调用，交给它要加载什么（Cesium 的运行时、MapLibre 引擎的三维模块），不等结果；
 * 什么时候真的加载（空闲、省流量模式跳过）由 app 决定（ADR 0091）
 */
export type MapRuntimePreloader = (load: () => Promise<unknown>) => void;

/** app 用它 provide 预加载的函数；没有 provide 时画布不预加载 */
export const MAP_RUNTIME_PRELOAD: InjectionKey<MapRuntimePreloader> = Symbol('map-runtime-preload');

/** app 用它 provide 地图错误的报告器，处理鉴权这类 map-vue 不认识的事；页面传了 onError 时以页面的为准，都没有时打印到控制台 */
export const MAP_ERROR_REPORTER: InjectionKey<(error: unknown) => void> = Symbol('map-error-reporter');
