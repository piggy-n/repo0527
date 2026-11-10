// 代码里的产品开关：所有部署都一样，改了要重新构建，不进 .env（分类见 docs/config/overview.md）

/** 三维的开关（ADR 0147） */
export interface SceneOptions {
  /** maplibre 引擎的三维里显示资源图层、点/框选能识别；关闭时这两项和 Cesium 一样，高斯泼溅照常（Cesium 不受影响） */
  readonly resourceLayers: boolean;
}

/** 只在这里改，不进 .env；用户 2026-11-09 决定三维里暂不显示资源图层，放开要先改页面设计 */
export const SCENE_OPTIONS: SceneOptions = { resourceLayers: false };
