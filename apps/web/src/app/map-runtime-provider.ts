import { MAP_RUNTIME, MAP_RUNTIME_PRELOAD, type MapRuntimeLoader, type MapRuntimePreloader } from '@yzt/map-vue';
import { type Component, defineComponent, h, provide } from 'vue';

/**
 * 给地图页包一层（ADR 0079 第 2 节）：页面里的画布需要另一个框架时，从这里取加载、预加载运行时的函数（ADR 0091），
 * 页面不知道运行时的存在。随地图页的分块动态加载：map-vue 连带 maplibre-gl 不进入口包（ADR 0061）；
 * 路由的 props、页面缓存都照常经过这一层
 */
export function withRuntimeLoader(page: Component, load: MapRuntimeLoader, preload: MapRuntimePreloader): Component {
  return defineComponent({
    name: 'MapRuntimeProvider',
    setup() {
      provide(MAP_RUNTIME, load);
      provide(MAP_RUNTIME_PRELOAD, preload);
      return () => h(page);
    }
  });
}
