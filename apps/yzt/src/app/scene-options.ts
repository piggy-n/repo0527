/** 三维的开关（ADR 0147） */
export interface SceneOptions {
  /** maplibre 引擎的三维里显示资源图层、点/框选能识别；关闭时和 Cesium 一样（Cesium 不受影响） */
  readonly resourceLayers: boolean;
}

/** 只在这里改，不进 .env；用户 2026-11-09 决定三维里暂不显示资源图层，放开要先改页面设计 */
export const SCENE_OPTIONS: SceneOptions = { resourceLayers: false };
