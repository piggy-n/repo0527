import type { CreateSceneRenderer, SceneBudgetSource, SceneRenderer } from '@mx/map-core';
import {
  MAP_ERROR_REPORTER,
  MAP_RUNTIME_PRELOAD,
  MAP_SCENE_ENGINE,
  MAPLIBRE_ENGINE,
  type MapRuntimePreloader,
  type SceneEngine
} from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, inject } from 'vue';
import { reportMapError } from '@/shared/map/backend-request';
import { SCENE_TIER_NOTICE } from '@/shared/map/scene-tier/scene-tier';
import { required } from '@/shared/testing/required';
import { createSceneEngine, type PageSceneTier, scenePreloader, withRuntimeLoader } from './map-runtime-provider';

// 注入给页面的三维引擎
function injectedEngine(): SceneEngine {
  const received: { engine?: SceneEngine | null } = {};
  const Page = defineComponent(() => {
    received.engine = inject(MAP_SCENE_ENGINE, null);
    return () => null;
  });
  mount(withRuntimeLoader(Page, vi.fn<MapRuntimePreloader>()));
  return required(received.engine, '页面拿到的三维引擎');
}

// 只经过微任务的等待：结束了的一定结束了
const settled = (promise: Promise<unknown>) =>
  Promise.race([promise.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 0))]);

describe('withRuntimeLoader', () => {
  it('页面里能取到预加载的函数、地图错误的报告器和降档的提示，路由给的参数照常传到页面', () => {
    const preload = vi.fn<MapRuntimePreloader>();
    const received: { preload?: MapRuntimePreloader | null; reporter?: unknown; notice?: unknown } = {};
    const Page = defineComponent({
      props: { regionCode: { type: String, required: true } },
      setup(props) {
        received.preload = inject(MAP_RUNTIME_PRELOAD, null);
        received.reporter = inject(MAP_ERROR_REPORTER, null);
        received.notice = inject(SCENE_TIER_NOTICE, null);
        return () => <p>{props.regionCode}</p>;
      }
    });
    const Wrapped = withRuntimeLoader(Page, preload);

    const wrapper = mount(Wrapped, { attrs: { regionCode: '320100' } });

    const load = vi.fn<() => Promise<unknown>>();
    required(received.preload, '页面拿到的预加载函数')(load);
    expect(preload).toHaveBeenCalledExactlyOnceWith(load);
    expect(received.reporter).toBe(reportMapError);
    expect(received.notice).toBeDefined();
    expect(received.notice).not.toBeNull();
    expect(wrapper.text()).toBe('320100');
  });

  it('注入的三维引擎：三维里画样式图层（ADR 0157），暂不识别，高斯泼溅照常', () => {
    expect(injectedEngine().capabilities).toStrictEqual({ styleLayers: true, identify: false, splats: true });
  });
});

// 档位来源：崩溃检查做完以前 prepare 不结束
function fakeTier() {
  let finish: (() => void) | undefined;
  const tier: PageSceneTier = {
    resolve: vi.fn<SceneBudgetSource['resolve']>(),
    subscribe: vi.fn<SceneBudgetSource['subscribe']>(),
    contextLost: vi.fn<() => void>(),
    shown: vi.fn<(shown: boolean) => void>(),
    loadSetting: vi.fn<PageSceneTier['loadSetting']>(),
    prepare: vi.fn<() => Promise<void>>(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    )
  };
  return { tier, prepared: () => finish?.() };
}

describe('createSceneEngine', () => {
  it('打开三维时等崩溃检查做完，再把档位来源交给渲染器', async () => {
    const renderer = {} as SceneRenderer;
    const create = vi.fn<CreateSceneRenderer>(() => renderer);
    const base: SceneEngine = { ...MAPLIBRE_ENGINE, loadRenderer: () => Promise.resolve(create) };
    const { tier, prepared } = fakeTier();
    const engine = createSceneEngine(base, () => tier);

    const loading = engine.loadRenderer();
    expect(await settled(loading)).toBe(false);
    prepared();
    const createWithTier = await loading;

    expect(createWithTier()).toBe(renderer);
    expect(create).toHaveBeenCalledExactlyOnceWith(tier);
  });
});

describe('scenePreloader', () => {
  it('预加载注入的三维引擎时换成只下载模块、读配置的函数；别的照原样', () => {
    const preload = vi.fn<MapRuntimePreloader>();
    const engine: SceneEngine = { ...MAPLIBRE_ENGINE, loadRenderer: () => Promise.reject(new Error('不该在预加载时调用')) };
    const preloadScene = vi.fn<() => Promise<unknown>>();
    const preloader = scenePreloader(preload, engine, preloadScene);

    preloader(engine.loadRenderer);
    const other = vi.fn<() => Promise<unknown>>();
    preloader(other);

    expect(preload.mock.calls).toStrictEqual([[preloadScene], [other]]);
  });
});
