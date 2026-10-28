import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indoorMapOf, type MapPlayer } from '../indoor-map/indoor-map';
import { twoLevelNavigation } from '../indoor-map/indoor-map-testing';
import { IndoorMapDialog } from './IndoorMapDialog';

const map = indoorMapOf(twoLevelNavigation());
const player: MapPlayer = { x: 5, y: 6, floor: -5, yaw: 0, hfov: 1.5, target: null };

// jsdom 没有画布的 2D 上下文、没有布局：只测界面和关闭；取景、双击瞬移在浏览器测试里
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('IndoorMapDialog', () => {
  it('标题、楼层按钮（人所在的那层标"当前"、默认选中）和操作说明', () => {
    const wrapper = mount(IndoorMapDialog, { props: { map, player } });

    expect(wrapper.text()).toContain('站内地图');
    expect(wrapper.findAll('label').map(label => label.text())).toStrictEqual(['-1F（当前）', '-2F']);
    expect(wrapper.get('.is-active').text()).toBe('-1F（当前）');
    expect(wrapper.text()).toContain('双击地图瞬移 · 拖动平移 · 滚轮缩放');
  });

  it('×、点遮罩、Esc 关闭；点面板里面不关；Esc 不传到页面（页面上 Esc 是退出漫游）', async () => {
    const wrapper = mount(IndoorMapDialog, { props: { map, player }, attachTo: document.body });
    const onWindowKey = vi.fn<(event: KeyboardEvent) => void>();
    window.addEventListener('keydown', onWindowKey);
    try {
      await wrapper.get('button[aria-label="关闭站内地图"]').trigger('click');
      await wrapper.get('[data-indoor-map]').trigger('pointerdown');
      await wrapper.get('.el-radio-group').trigger('pointerdown');
      await wrapper.get('[data-indoor-map]').trigger('keydown', { key: 'Escape' });

      expect(wrapper.emitted('close')).toHaveLength(3);
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('打开时焦点在地图上，Esc 直接起作用', () => {
    const wrapper = mount(IndoorMapDialog, { props: { map, player }, attachTo: document.body });
    expect(document.activeElement).toBe(wrapper.get('[data-indoor-map]').element);
  });
});
