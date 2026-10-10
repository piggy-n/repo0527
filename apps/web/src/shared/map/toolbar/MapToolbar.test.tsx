import type { CameraState } from '@yzt/map-core';
import { type MapHandle, provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { MapToolbar } from './MapToolbar';
import type { ToolbarActionId, ToolbarItemId } from './toolbar-items';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

/** 页面登记测距和一个工具栏上没有的工具 probe，渲染工具栏；不需要画布，工具在会话里切换 */
function mountToolbar(
  items: readonly ToolbarItemId[],
  actions: Partial<Record<ToolbarActionId, () => void>> = {},
  pressed: readonly ToolbarActionId[] = []
) {
  let handle: MapHandle<'basemap'> | undefined;
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['basemap'], camera: CAMERA });
    map.registerTools({ probe: { persistent: false }, 'measure-distance': { persistent: false } });
    handle = map;
    return () => <MapToolbar items={items} actions={actions} pressed={pressed} />;
  });
  const wrapper = mount(Page);
  if (!handle) {
    throw new Error('页面没有创建地图');
  }
  return { wrapper, map: handle };
}

function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find(candidate => candidate.text() === label);
  if (!found) {
    throw new Error(`没有"${label}"按钮`);
  }
  return found;
}

// 联调用的外壳只测关键交互：工具按钮跟随并切换当前工具，动作按钮调用页面的回调
describe('MapToolbar', () => {
  it('按页面给出的列表显示按钮', () => {
    const { wrapper } = mountToolbar(['default-view', 'browse']);

    expect(wrapper.findAll('button').map(candidate => candidate.text())).toStrictEqual(['默认视角', '移动']);
  });

  it('工具按钮跟随当前工具；点击没有激活的工具时激活它', async () => {
    const { wrapper, map } = mountToolbar(['browse']);
    expect(button(wrapper, '移动').classes()).toContain('el-button--primary');

    map.activateTool('probe');
    await nextTick();
    expect(button(wrapper, '移动').classes()).not.toContain('el-button--primary');

    await button(wrapper, '移动').trigger('click');

    expect(map.activeTool.value).toBe('browse');
    expect(button(wrapper, '移动').classes()).toContain('el-button--primary');
  });

  it('点击已激活的工具时退出，回到常驻的"移动"', async () => {
    const { wrapper, map } = mountToolbar(['browse', 'measure-distance']);

    await button(wrapper, '测距').trigger('click');
    expect(map.activeTool.value).toBe('measure-distance');
    expect(button(wrapper, '测距').classes()).toContain('el-button--primary');

    await button(wrapper, '测距').trigger('click');

    expect(map.activeTool.value).toBe('browse');
    expect(button(wrapper, '测距').classes()).not.toContain('el-button--primary');
  });

  it('动作按钮调用页面的回调；没有回调时不可用', async () => {
    const goToDefaultView = vi.fn<() => void>();
    const withAction = mountToolbar(['default-view'], { 'default-view': goToDefaultView });
    const withoutAction = mountToolbar(['default-view']);

    await button(withAction.wrapper, '默认视角').trigger('click');

    expect(goToDefaultView).toHaveBeenCalledOnce();
    expect(button(withoutAction.wrapper, '默认视角').attributes('disabled')).toBeDefined();
  });

  it('页面告诉工具栏哪些动作显示为按下', () => {
    const toggle = vi.fn<() => void>();
    const { wrapper } = mountToolbar(['region-locate', 'clear'], { 'region-locate': toggle, clear: toggle }, [
      'region-locate'
    ]);

    expect(button(wrapper, '区划定位').classes()).toContain('el-button--primary');
    expect(button(wrapper, '区划定位').attributes('aria-pressed')).toBe('true');
    expect(button(wrapper, '清除').classes()).not.toContain('el-button--primary');
    expect(button(wrapper, '清除').attributes('aria-pressed')).toBe('false');
  });
});
