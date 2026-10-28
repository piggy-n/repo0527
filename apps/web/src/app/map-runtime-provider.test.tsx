import { mount } from '@vue/test-utils';
import { MAP_RUNTIME, MAP_RUNTIME_PRELOAD, type MapRuntimeLoader, type MapRuntimePreloader } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, inject } from 'vue';
import { withRuntimeLoader } from './map-runtime-provider';

describe('withRuntimeLoader', () => {
  it('页面里能取到加载、预加载运行时的函数，路由给的参数照常传到页面', () => {
    const load = vi.fn<MapRuntimeLoader>(() => Promise.resolve());
    const preload = vi.fn<MapRuntimePreloader>();
    let received: MapRuntimeLoader | null = null;
    let receivedPreload: MapRuntimePreloader | null = null;
    const Page = defineComponent({
      props: { regionCode: { type: String, required: true } },
      setup(props) {
        received = inject(MAP_RUNTIME, null);
        receivedPreload = inject(MAP_RUNTIME_PRELOAD, null);
        return () => <p>{props.regionCode}</p>;
      }
    });
    const Wrapped = withRuntimeLoader(Page, load, preload);

    const wrapper = mount(Wrapped, { attrs: { regionCode: '320100' } });

    expect(received).toBe(load);
    expect(receivedPreload).toBe(preload);
    expect(wrapper.text()).toBe('320100');
  });
});
