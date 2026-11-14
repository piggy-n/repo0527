import type { SceneBudgetSource } from '@mx/map-core';
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
import {
  createSceneTierSource,
  SCENE_TIER_NOTICE,
  type SceneTierSource
} from '@/shared/map/scene-tier/scene-tier';

/** 三维引擎要的档位来源：预算、读配置、打开三维前的崩溃检查 */
export type PageSceneTier = SceneBudgetSource & Pick<SceneTierSource, 'prepare' | 'loadSetting'>;

/**
 * 注入的三维引擎（ADR 0147 第 3 节）：能力原样（三维里照常显示资源图层、点/框选，ADR 0157；高斯泼溅，ADR 0149）。
 * 打开三维时等部署的档位读到、问完留下崩溃标记的页面，再按档位创建渲染器（ADR 0155 第 4、6 节）
 */
export function createSceneEngine(base: SceneEngine, sceneTier: () => PageSceneTier): SceneEngine {
  return Object.freeze({
    capabilities: base.capabilities,
    loadRenderer: async () => {
      const tier = sceneTier();
      const [create] = await Promise.all([base.loadRenderer(), tier.prepare()]);
      return () => create(tier);
    }
  });
}

/** 画布交来要预加载的是注入的三维引擎时，只下载模块、读部署的档位，问别的页面留到真的打开三维（ADR 0155 第 4 节） */
export function scenePreloader(
  preload: MapRuntimePreloader,
  engine: SceneEngine,
  preloadScene: () => Promise<unknown>
): MapRuntimePreloader {
  return load => preload(load === engine.loadRenderer ? preloadScene : load);
}

let sceneTier: SceneTierSource | undefined;

// 一个页面一个：崩溃标记按页面记，所有地图页的三维共用。第一个地图页打开时才建
function pageSceneTier(): SceneTierSource {
  sceneTier ??= createSceneTierSource();
  return sceneTier;
}

const SCENE_ENGINE = createSceneEngine(MAPLIBRE_ENGINE, pageSceneTier);

const preloadScene = () => Promise.all([MAPLIBRE_ENGINE.loadRenderer(), pageSceneTier().loadSetting()]);

/**
 * 给地图页包一层（ADR 0079 第 2 节）：页面里的画布从这里取预加载三维模块的函数（ADR 0091），页面不知道它的存在。
 * 随地图页的分块动态加载：map-vue 连带 maplibre-gl 不进入口包（ADR 0061）；路由的 props、页面缓存都照常经过这一层。
 * 地图错误的报告器也从这里提供：瓦片的 401 按登录过期处理，页面不用各写一遍。
 * 三维引擎和它的能力也在这里注入（ADR 0147 第 3 节），页面和拥有者只看能力；三维降档的提示从这里取（ADR 0155）
 */
export function withRuntimeLoader(page: Component, preload: MapRuntimePreloader): Component {
  return defineComponent({
    name: 'MapRuntimeProvider',
    setup() {
      provide(MAP_RUNTIME_PRELOAD, scenePreloader(preload, SCENE_ENGINE, preloadScene));
      provide(MAP_ERROR_REPORTER, reportMapError);
      provide(MAP_SCENE_ENGINE, SCENE_ENGINE);
      provide(SCENE_TIER_NOTICE, pageSceneTier());
      return () => h(page);
    }
  });
}
