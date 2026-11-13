import type { CameraState, MapLike } from '@mx/map-core';
import { MapCanvas, provideMap } from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, provide, shallowRef } from 'vue';
import { MapStatusNotice } from './MapStatusNotice';
import { SCENE_TIER_NOTICE, type SceneTierNotice, type SceneTierNoticeSource } from './scene-tier/scene-tier';

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

// app 提供的降档提示：恢复、关掉以后不再显示
function fakeTierNotice(initial: SceneTierNotice) {
  const notice = shallowRef<SceneTierNotice | null>(initial);
  const restore = vi.fn<() => void>(() => {
    notice.value = null;
  });
  const dismissNotice = vi.fn<() => void>(() => {
    notice.value = null;
  });
  const source: SceneTierNoticeSource = { notice, restore, dismissNotice };
  return { source, restore, dismissNotice };
}

function mountWithTier(source: SceneTierNoticeSource) {
  let setDimension: ((kind: '2d' | '3d') => void) | undefined;
  const wrapper = mount(
    defineComponent(() => {
      provide(SCENE_TIER_NOTICE, source);
      const map = provideMap({ groups: ['basemap'], camera: CAMERA, onError: () => undefined });
      setDimension = kind => map.setDimension(kind);
      return () => (
        <div>
          <MapStatusNotice />
        </div>
      );
    })
  );
  return { wrapper, setDimension: (kind: '2d' | '3d') => setDimension?.(kind) };
}

describe('MapStatusNotice 的三维降档提示（ADR 0155）', () => {
  it('只在三维里显示；能恢复时有"恢复原来的画质"，点了立即恢复、提示消失', async () => {
    const { source, restore } = fakeTierNotice({ restorable: true, restoredBefore: false });
    const { wrapper, setDimension } = mountWithTier(source);
    await nextTick();
    expect(wrapper.find('[data-map-status="scene-tier"]').exists()).toBe(false);

    setDimension('3d');
    await nextTick();
    const bar = wrapper.get('[data-map-status="scene-tier"]');
    expect(bar.text()).toContain('三维画质已调低');
    expect(bar.text()).toContain('上次打开三维时页面崩溃了。');
    const buttons = bar.findAll('button');
    expect(buttons.map(button => button.text())).toStrictEqual(['恢复原来的画质', '知道了']);

    await buttons[0]?.trigger('click');
    expect(restore).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-map-status="scene-tier"]').exists()).toBe(false);
  });

  it('恢复过的页面又崩：只有"知道了"，说明要找管理员', async () => {
    const { source, dismissNotice } = fakeTierNotice({ restorable: false, restoredBefore: true });
    const { wrapper, setDimension } = mountWithTier(source);
    setDimension('3d');
    await nextTick();

    const bar = wrapper.get('[data-map-status="scene-tier"]');
    expect(bar.text()).toContain('恢复后又崩溃过。如需恢复，请联系管理员调整配置。');
    expect(bar.findAll('button').map(button => button.text())).toStrictEqual(['知道了']);
    await bar.get('button').trigger('click');
    expect(dismissNotice).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-map-status="scene-tier"]').exists()).toBe(false);
  });

  it('恢复以后别的页面又崩：照样能恢复，注明恢复后又崩溃过', async () => {
    const { wrapper, setDimension } = mountWithTier(fakeTierNotice({ restorable: true, restoredBefore: true }).source);
    setDimension('3d');
    await nextTick();

    const bar = wrapper.get('[data-map-status="scene-tier"]');
    expect(bar.text()).toContain('上次打开三维时页面崩溃了，恢复后又崩溃过。');
    expect(bar.findAll('button')).toHaveLength(2);
  });
});
