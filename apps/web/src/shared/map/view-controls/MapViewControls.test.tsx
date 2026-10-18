import type { CameraState } from '@yzt/map-core';
import { type MapViewSwitchState, provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, shallowRef } from 'vue';
import { MapViewControls } from './MapViewControls';

const RANGE = { minZoom: 5, maxZoom: 18 };

/** 页面创建地图（没有画布），渲染基础组；缩放的过程在 useZoomButtons 的测试里 */
function mountControls(zoom: number, bearing = 0) {
  const camera: CameraState = { center: [119.4, 32.9], zoom, bearing, pitch: 0 };
  const goToDefaultView = vi.fn<() => void>();
  const Page = defineComponent(() => {
    provideMap({ groups: ['basemap'], camera });
    return () => <MapViewControls goToDefaultView={goToDefaultView} zoomRange={RANGE} />;
  });
  return { wrapper: mount(Page), goToDefaultView };
}

const button = (wrapper: VueWrapper, label: string) => wrapper.get(`button[aria-label="${label}"]`);

describe('MapViewControls', () => {
  it('切换请求交给拥有者，按下状态直到完成交接才改变，加载中可返回原视图', async () => {
    const state = shallowRef<MapViewSwitchState>({ current: '2d', target: '3d', status: 'loading' });
    const switchTo = vi.fn<(kind: '2d' | '3d') => void>();
    const wrapper = mount(defineComponent(() => {
      provideMap({ groups: ['basemap'], camera: { center: [119, 32], zoom: 10, bearing: 0, pitch: 0 } });
      return () => <MapViewControls
        goToDefaultView={() => undefined}
        zoomRange={RANGE}
        viewSwitch={state.value}
        onSwitch={switchTo}
      />;
    }));
    expect(button(wrapper, '二维').attributes('aria-pressed')).toBe('true');
    expect(button(wrapper, '三维').attributes('aria-busy')).toBe('true');
    await button(wrapper, '二维').trigger('click');
    await button(wrapper, '三维').trigger('click');
    expect(switchTo.mock.calls).toEqual([['2d'], ['3d']]);
    expect(button(wrapper, '三维').attributes('aria-pressed')).toBe('false');
    state.value = { current: '3d', target: '3d', status: 'ready' };
    await nextTick();
    expect(button(wrapper, '三维').attributes('aria-pressed')).toBe('true');
    expect(button(wrapper, '二维').attributes('aria-pressed')).toBe('false');
    state.value = { current: null, target: '2d', status: 'failed', error: new Error('首次加载失败') };
    await nextTick();
    expect(button(wrapper, '二维').attributes('aria-pressed')).toBe('false');
    expect(button(wrapper, '三维').attributes('aria-pressed')).toBe('false');
  });

  it('显示向下取整的层级，完整的级别在提示和无障碍名称里', () => {
    const { wrapper } = mountControls(13.6);

    const level = wrapper.get('[role="status"]');
    expect(level.text()).toBe('13');
    expect(level.attributes('aria-label')).toBe('当前层级 13（13.6）');
  });

  it('到了最大级别时放大不可用，最小级别时缩小不可用', () => {
    expect(button(mountControls(18).wrapper, '放大').attributes('disabled')).toBeDefined();
    expect(button(mountControls(18).wrapper, '缩小').attributes('disabled')).toBeUndefined();
    expect(button(mountControls(5).wrapper, '缩小').attributes('disabled')).toBeDefined();
  });

  it('指北针在"缩小"下面，和放大、缩小在同一段；图标跟着地图转，提示写出转过的角度（ADR 0058）', () => {
    const { wrapper } = mountControls(10, 35);
    const labels = wrapper.findAll('button').map(item => item.attributes('aria-label'));
    const compass = wrapper.get('button[aria-label^="指北针"]');

    expect(labels.slice(0, 4)).toStrictEqual(['放大', '缩小', '指北针：恢复正北、垂直俯视（旋转 35°）', '默认视角']);
    // 指北针和放大、缩小之间没有分隔线，和默认视角之间有
    expect(compass.element.previousElementSibling?.getAttribute('role')).not.toBe('separator');
    expect(compass.element.nextElementSibling?.getAttribute('role')).toBe('separator');
    expect(compass.get('svg').attributes('style')).toContain('rotate(-35deg)');
  });

  it('正北时指针不转，照常可以点', () => {
    const compass = mountControls(10).wrapper.get('button[aria-label="指北针：恢复正北、垂直俯视"]');

    expect(compass.get('svg').attributes('style') ?? '').not.toContain('rotate');
    expect(compass.attributes('disabled')).toBeUndefined();
  });

  it('"默认视角"调用页面给的回调', async () => {
    const { wrapper, goToDefaultView } = mountControls(10);

    await button(wrapper, '默认视角').trigger('click');

    expect(goToDefaultView).toHaveBeenCalledOnce();
  });

  it('二维是当前的；三维暂未开放，点了没有效果', async () => {
    const { wrapper } = mountControls(10);

    expect(button(wrapper, '二维').attributes('aria-pressed')).toBe('true');
    expect(button(wrapper, '三维').attributes('aria-disabled')).toBe('true');
    await button(wrapper, '三维').trigger('click');
    expect(button(wrapper, '二维').attributes('aria-pressed')).toBe('true');
  });
});
