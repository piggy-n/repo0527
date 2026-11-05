import type { CameraState, MapLike } from '@yzt/map-core';
import { MapCanvas, provideMap } from '@yzt/map-vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { MapStatusNotice } from './MapStatusNotice';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

// 联调用的界面只测关键交互：引擎失败时显示原因，点"重试"重新创建地图
describe('MapStatusNotice', () => {
  it('引擎失败时显示原因和"重试"，点击后重新创建地图', async () => {
    let attempts = 0;
    const createMap = (): MapLike => {
      attempts++;
      throw new Error('创建地图失败');
    };
    const wrapper = mount(
      defineComponent(() => {
        provideMap({ groups: ['basemap'], camera: CAMERA, onError: () => undefined });
        return () => (
          <div>
            <MapCanvas createMap={createMap} />
            <MapStatusNotice />
          </div>
        );
      })
    );
    await nextTick();

    expect(wrapper.text()).toContain('地图无法显示');
    expect(wrapper.text()).toContain('创建地图失败');

    // 重试的过程不应抛错
    await expect(wrapper.find('button').trigger('click')).resolves.toBeUndefined();
    await expect(nextTick()).resolves.toBeUndefined();

    expect(attempts).toBe(2);
  });
});
