import {
  CESIUM_ENGINE,
  MAP_ERROR_REPORTER,
  MAP_RUNTIME,
  MAP_RUNTIME_PRELOAD,
  MAP_SCENE_ENGINE,
  MAPLIBRE_ENGINE,
  type MapRuntimeLoader,
  type MapRuntimePreloader,
  type SceneEngine
} from '@mx/map-vue';
import { type Component, defineComponent, h, provide } from 'vue';
import { type Map3dEngine, appConfig } from '@/shared/config/app-config';
import { reportMapError } from '@/shared/map/backend-request';

const SCENE_ENGINES: Readonly<Record<Map3dEngine, SceneEngine>> = { cesium: CESIUM_ENGINE, maplibre: MAPLIBRE_ENGINE };

/**
 * 给地图页包一层（ADR 0079 第 2 节）：页面里的画布需要另一个框架时，从这里取加载、预加载运行时的函数（ADR 0091），
 * 页面不知道运行时的存在。随地图页的分块动态加载：map-vue 连带 maplibre-gl 不进入口包（ADR 0061）；
 * 路由的 props、页面缓存都照常经过这一层。地图错误的报告器也从这里提供：瓦片的 401 按登录过期处理，页面不用各写一遍。
 * 三维引擎按 .env 选择后在这里注入（ADR 0147 第 1 节），页面和拥有者不知道用的是哪一种
 */
export function withRuntimeLoader(
  page: Component,
  load: MapRuntimeLoader,
  preload: MapRuntimePreloader,
  engine: Map3dEngine = appConfig.map3dEngine
): Component {
  return defineComponent({
    name: 'MapRuntimeProvider',
    setup() {
      provide(MAP_RUNTIME, load);
      provide(MAP_RUNTIME_PRELOAD, preload);
      provide(MAP_ERROR_REPORTER, reportMapError);
      provide(MAP_SCENE_ENGINE, SCENE_ENGINES[engine]);
      return () => h(page);
    }
  });
}
