import type { SceneRendererLoader } from '@mx/map-core';
import type { InjectionKey } from 'vue';

/**
 * 三维引擎能做什么（ADR 0147 第 3 节、ADR 0020 第 4 节）：页面和拥有者按它和当前维度决定显示什么。
 * app 注入时收窄：现在三维里不显示资源图层、不识别，等页面重新设计（ADR 0153）
 */
export interface SceneCapabilities {
  /** 三维里照常画二维样式的全部图层（矢量瓦片、花纹、注记），不只是镜像的 GeoJSON 覆盖物 */
  readonly styleLayers: boolean;
  /** 三维期间点/框选能识别：三维视图的渲染要素查询有结果 */
  readonly identify: boolean;
  /** 三维里能显示 LCC2 高斯泼溅（ADR 0149）：为 false 时三维模型面板不列出这类模型 */
  readonly splats: boolean;
}

/**
 * 三维引擎的描述（ADR 0147 第 1 节，单引擎见 ADR 0153），由 app 收窄能力后 provide：
 * MapCanvas 的同一个视图承担三维，第一次切到三维时用 loadRenderer 加载 @mx/map-three
 */
export interface SceneEngine {
  readonly capabilities: SceneCapabilities;
  readonly loadRenderer: SceneRendererLoader;
}

/** MapLibre + Three.js（ADR 0147）：@mx/map-three 和 three 在预加载或第一次切到三维时才下载 */
export const MAPLIBRE_ENGINE: SceneEngine = Object.freeze({
  capabilities: Object.freeze({ styleLayers: true, identify: true, splats: true }),
  loadRenderer: () => import('@mx/map-three').then(({ createSceneRenderer }) => createSceneRenderer)
});

/** app 用它 provide 三维引擎；没有 provide 时用 MAPLIBRE_ENGINE 的完整能力 */
export const MAP_SCENE_ENGINE: InjectionKey<SceneEngine> = Symbol('map-scene-engine');

/**
 * 预加载：画布觉得是时候了就调用，交给它要加载什么（三维模块），不等结果；
 * 什么时候真的加载（空闲、省流量模式跳过）由 app 决定（ADR 0091）
 */
export type MapRuntimePreloader = (load: () => Promise<unknown>) => void;

/** app 用它 provide 预加载的函数；没有 provide 时画布不预加载 */
export const MAP_RUNTIME_PRELOAD: InjectionKey<MapRuntimePreloader> = Symbol('map-runtime-preload');

/** app 用它 provide 地图错误的报告器，处理鉴权这类 map-vue 不认识的事；页面传了 onError 时以页面的为准，都没有时打印到控制台 */
export const MAP_ERROR_REPORTER: InjectionKey<(error: unknown) => void> = Symbol('map-error-reporter');
