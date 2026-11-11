import {
  MAP_ERROR_REPORTER,
  MAP_RUNTIME_PRELOAD,
  MAP_SCENE_ENGINE,
  MAPLIBRE_ENGINE,
  type MapRuntimePreloader,
  type SceneEngine
} from '@mx/map-vue';
import { type Component, defineComponent, h, provide } from 'vue';
import { reportMapError } from '@/shared/map/backend-request';
import { SCENE_OPTIONS, type SceneOptions } from '@/shared/config/scene-options';

// 开关关着时三维里不显示资源图层，点/框选不识别；高斯泼溅照常（ADR 0149）
const WITHOUT_RESOURCES: SceneEngine = Object.freeze({
  ...MAPLIBRE_ENGINE,
  capabilities: Object.freeze({ ...MAPLIBRE_ENGINE.capabilities, styleLayers: false, identify: false })
});

function sceneEngineOf({ resourceLayers }: SceneOptions): SceneEngine {
  return resourceLayers ? MAPLIBRE_ENGINE : WITHOUT_RESOURCES;
}

/**
 * 给地图页包一层（ADR 0079 第 2 节）：页面里的画布从这里取预加载三维模块的函数（ADR 0091），页面不知道它的存在。
 * 随地图页的分块动态加载：map-vue 连带 maplibre-gl 不进入口包（ADR 0061）；路由的 props、页面缓存都照常经过这一层。
 * 地图错误的报告器也从这里提供：瓦片的 401 按登录过期处理，页面不用各写一遍。
 * 三维引擎的能力按三维的开关收窄后在这里注入（ADR 0147 第 3 节），页面和拥有者只看能力
 */
export function withRuntimeLoader(
  page: Component,
  preload: MapRuntimePreloader,
  options: SceneOptions = SCENE_OPTIONS
): Component {
  return defineComponent({
    name: 'MapRuntimeProvider',
    setup() {
      provide(MAP_RUNTIME_PRELOAD, preload);
      provide(MAP_ERROR_REPORTER, reportMapError);
      provide(MAP_SCENE_ENGINE, sceneEngineOf(options));
      return () => h(page);
    }
  });
}
