import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indoorMapOf, type MapPlayer } from '../indoor-map/indoor-map';
import { twoLevelNavigation } from '../indoor-map/indoor-map-testing';
import { IndoorMinimap } from './IndoorMinimap';

const map = indoorMapOf(twoLevelNavigation());
const player: MapPlayer = { x: 5, y: 6, floor: -5, yaw: 0, hfov: 1.5, target: null };

// jsdom 没有画布的 2D 上下文：画图跳过，只测界面
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('IndoorMinimap', () => {
  it('显示人所在的楼层和比例尺；换到别的楼层时跟着换', async () => {
    const wrapper = mount(IndoorMinimap, { props: { map, player } });
    expect(wrapper.text()).toContain('-1F · 北↑');
    expect(wrapper.text()).toContain('10 m');

    await wrapper.setProps({ player: { ...player, x: 30, floor: -10 } });
    expect(wrapper.text()).toContain('-2F · 北↑');
  });

  it('+/− 在 20～160 米之间逐档缩放，到头时按钮不能点', async () => {
    const wrapper = mount(IndoorMinimap, { props: { map, player } });
    const zoomIn = wrapper.get('button[aria-label="放大"]');
    const zoomOut = wrapper.get('button[aria-label="缩小"]');

    await zoomIn.trigger('click');
    expect(wrapper.text()).toContain('5 m');
    expect(zoomIn.attributes('disabled')).toBeDefined();
    await zoomOut.trigger('click');
    await zoomOut.trigger('click');
    await zoomOut.trigger('click');
    expect(wrapper.text()).toContain('50 m');
    expect(zoomOut.attributes('disabled')).toBeDefined();
    expect(zoomIn.attributes('disabled')).toBeUndefined();
  });

  it('点地图、按回车打开完整地图', async () => {
    const wrapper = mount(IndoorMinimap, { props: { map, player } });
    const canvas = wrapper.get('canvas');

    await canvas.trigger('click');
    await canvas.trigger('keydown', { key: 'Enter' });
    await canvas.trigger('keydown', { key: 'Enter', isComposing: true });

    expect(wrapper.emitted('open')).toHaveLength(2);
  });
});
