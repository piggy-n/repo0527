import { mount } from '@vue/test-utils';
import {
  MAP_ERROR_REPORTER,
  MAP_RUNTIME_PRELOAD,
  MAP_SCENE_ENGINE,
  MAPLIBRE_ENGINE,
  type MapRuntimePreloader,
  type SceneEngine
} from '@mx/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, inject } from 'vue';
import { reportMapError } from '@/shared/map/backend-request';
import { required } from '@/shared/testing/required';
import { withRuntimeLoader } from './map-runtime-provider';

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

describe('withRuntimeLoader', () => {
  it('页面里能取到预加载的函数和地图错误的报告器，路由给的参数照常传到页面', () => {
    const preload = vi.fn<MapRuntimePreloader>();
    let receivedPreload: MapRuntimePreloader | null = null;
    let receivedReporter: ((error: unknown) => void) | null = null;
    const Page = defineComponent({
      props: { regionCode: { type: String, required: true } },
      setup(props) {
        receivedPreload = inject(MAP_RUNTIME_PRELOAD, null);
        receivedReporter = inject(MAP_ERROR_REPORTER, null);
        return () => <p>{props.regionCode}</p>;
      }
    });
    const Wrapped = withRuntimeLoader(Page, preload);

    const wrapper = mount(Wrapped, { attrs: { regionCode: '320100' } });

    expect(receivedPreload).toBe(preload);
    expect(receivedReporter).toBe(reportMapError);
    expect(wrapper.text()).toBe('320100');
  });

  it('注入的三维引擎照常加载 map-three；三维里不画样式图层、不识别（等页面重新设计），高斯泼溅照常', () => {
    const engine = injectedEngine();

    expect(engine.loadRenderer).toBe(MAPLIBRE_ENGINE.loadRenderer);
    expect(engine.capabilities).toStrictEqual({ styleLayers: false, identify: false, splats: true });
  });
});
