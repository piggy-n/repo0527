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
import { reportMapError } from '@/shared/map/backend-request';
import { withRuntimeLoader } from './map-runtime-provider';

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
    let received: SceneEngine | null = null;
    const Page = defineComponent(() => {
      received = inject(MAP_SCENE_ENGINE, null);
      return () => null;
    });

    mount(withRuntimeLoader(Page, vi.fn<MapRuntimeLoader>(), vi.fn<MapRuntimePreloader>(), engine));

    expect(received).toBe(expected);
  });
});
