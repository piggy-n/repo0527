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

// 三维里暂不显示资源图层、点/框选不识别，等页面重新设计（ADR 0153）；高斯泼溅照常（ADR 0149）
const SCENE_ENGINE: SceneEngine = Object.freeze({
  ...MAPLIBRE_ENGINE,
  capabilities: Object.freeze({ ...MAPLIBRE_ENGINE.capabilities, styleLayers: false, identify: false })
});

/**
 * 给地图页包一层（ADR 0079 第 2 节）：页面里的画布从这里取预加载三维模块的函数（ADR 0091），页面不知道它的存在。
 * 随地图页的分块动态加载：map-vue 连带 maplibre-gl 不进入口包（ADR 0061）；路由的 props、页面缓存都照常经过这一层。
 * 地图错误的报告器也从这里提供：瓦片的 401 按登录过期处理，页面不用各写一遍。
 * 三维引擎和它的能力也在这里注入（ADR 0147 第 3 节），页面和拥有者只看能力
 */
export function withRuntimeLoader(page: Component, preload: MapRuntimePreloader): Component {
  return defineComponent({
    name: 'MapRuntimeProvider',
    setup() {
      provide(MAP_RUNTIME_PRELOAD, preload);
      provide(MAP_ERROR_REPORTER, reportMapError);
      provide(MAP_SCENE_ENGINE, SCENE_ENGINE);
      return () => h(page);
    }
  });
}
