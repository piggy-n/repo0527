import type { CreateSceneRenderer } from '@mx/map-core';
import { ThreeSceneRenderer } from './three-scene-renderer';

/** MapLibre 引擎的三维渲染器（ADR 0147）：只由 map-vue 动态导入，交给 MapLibre 适配器 */
export const createSceneRenderer: CreateSceneRenderer = () => new ThreeSceneRenderer();
