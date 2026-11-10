import { mount } from '@vue/test-utils';
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
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, inject } from 'vue';
import type { Map3dEngine } from '@/shared/config/app-config';
import { reportMapError } from '@/shared/map/backend-request';
import { required } from '@/shared/testing/required';
import { withRuntimeLoader } from './map-runtime-provider';
import { SCENE_OPTIONS, type SceneOptions } from '@/shared/config/scene-options';

// 注入给页面的三维引擎
function injectedEngine(engine: Map3dEngine, options?: SceneOptions): SceneEngine {
  const received: { engine?: SceneEngine | null } = {};
  const Page = defineComponent(() => {
    received.engine = inject(MAP_SCENE_ENGINE, null);
    return () => null;
  });
  mount(withRuntimeLoader(Page, vi.fn<MapRuntimeLoader>(), vi.fn<MapRuntimePreloader>(), engine, options));
  return required(received.engine, '页面拿到的三维引擎');
}

describe('withRuntimeLoader', () => {
  it('页面里能取到加载、预加载运行时的函数和地图错误的报告器，路由给的参数照常传到页面', () => {
    const load = vi.fn<MapRuntimeLoader>(() => Promise.resolve());
    const preload = vi.fn<MapRuntimePreloader>();
    let received: MapRuntimeLoader | null = null;
    let receivedPreload: MapRuntimePreloader | null = null;
    let receivedReporter: ((error: unknown) => void) | null = null;
    const Page = defineComponent({
      props: { regionCode: { type: String, required: true } },
      setup(props) {
        received = inject(MAP_RUNTIME, null);
        receivedPreload = inject(MAP_RUNTIME_PRELOAD, null);
        receivedReporter = inject(MAP_ERROR_REPORTER, null);
        return () => <p>{props.regionCode}</p>;
      }
    });
    const Wrapped = withRuntimeLoader(Page, load, preload);

    const wrapper = mount(Wrapped, { attrs: { regionCode: '320100' } });

    expect(received).toBe(load);
    expect(receivedPreload).toBe(preload);
    expect(receivedReporter).toBe(reportMapError);
    expect(wrapper.text()).toBe('320100');
  });

  it.each([
    ['cesium', CESIUM_ENGINE],
    ['maplibre', MAPLIBRE_ENGINE]
  ] as const)('按 .env 的三维引擎（%s）注入引擎的描述，页面只拿到描述（ADR 0147 第 1 节）', (engine, expected) => {
    expect(injectedEngine(engine, { resourceLayers: true })).toBe(expected);
  });

  it('三维的资源图层开关关着时，maplibre 引擎的能力和 Cesium 一样，照常加载 map-three；Cesium 不受影响', () => {
    const off = { resourceLayers: false };
    const maplibre = injectedEngine('maplibre', off);

    expect(maplibre).toMatchObject({ kind: 'maplibre', loadRenderer: MAPLIBRE_ENGINE.loadRenderer });
    expect(maplibre.capabilities).toStrictEqual({ styleLayers: false, identify: false });
    expect(injectedEngine('cesium', off)).toBe(CESIUM_ENGINE);
  });

  it('不传开关时按 SCENE_OPTIONS：默认关着，三维里不显示资源图层（用户 2026-11-09 决定）', () => {
    expect(SCENE_OPTIONS.resourceLayers).toBe(false);
    expect(injectedEngine('maplibre').capabilities).toStrictEqual({ styleLayers: false, identify: false });
  });
});
