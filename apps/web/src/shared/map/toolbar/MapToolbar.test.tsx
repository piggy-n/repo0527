import type { CameraState } from '@yzt/map-core';
import { type MapHandle, provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { MapToolbar } from './MapToolbar';
import {
  buttonLines,
  FEATURE_PICK_TOOL,
  labelLines,
  TOOLBAR_TOOLS,
  type ToolbarActionId,
  type ToolbarItemId
} from './toolbar-items';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

/** 页面登记测距和一个工具栏上没有的工具 probe，渲染工具栏；不需要画布，工具在会话里切换 */
function mountToolbar(
  groups: readonly (readonly ToolbarItemId[])[],
  actions: Partial<Record<ToolbarActionId, () => void>> = {},
  pressed: readonly ToolbarActionId[] = [],
  compact = false
) {
  let handle: MapHandle<'basemap'> | undefined;
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['basemap'], camera: CAMERA });
    map.registerTools({ probe: { persistent: false }, 'measure-distance': { persistent: false } });
    handle = map;
    return () => <MapToolbar groups={groups} actions={actions} pressed={pressed} compact={compact} />;
  });
  const wrapper = mount(Page);
  if (!handle) {
    throw new Error('页面没有创建地图');
  }
  return { wrapper, map: handle };
}

// 按无障碍名称找：按钮上的文字分了行，只显示图标时没有文字
function button(wrapper: VueWrapper, label: string) {
  return wrapper.get(`button[aria-label="${label}"]`);
}

const isActive = (wrapper: VueWrapper, label: string) => button(wrapper, label).classes().join(' ').includes('_active_');
const isPressed = (wrapper: VueWrapper, label: string) => button(wrapper, label).classes().join(' ').includes('_pressed_');

describe('labelLines', () => {
  it('每行两个字', () => {
    expect(labelLines('测距')).toStrictEqual(['测距']);
    expect(labelLines('区划定位')).toStrictEqual(['区划', '定位']);
    expect(labelLines('默认视角了')).toStrictEqual(['默认', '视角', '了']);
  });
});

describe('buttonLines', () => {
  it('条目指定了分行时按它（"点/框选"不拆开），否则每行两个字', () => {
    expect(buttonLines(TOOLBAR_TOOLS[FEATURE_PICK_TOOL])).toStrictEqual(['点/框选']);
    expect(buttonLines({ label: '区划定位', icon: 'map-region-locate' })).toStrictEqual(['区划', '定位']);
  });
});

describe('MapToolbar', () => {
  it('按页面给出的分组显示按钮，组之间有分隔线；文字每行两个字', () => {
    const { wrapper } = mountToolbar([['browse'], ['measure-distance', 'region-locate']]);

    expect(wrapper.findAll('button').map(candidate => candidate.attributes('aria-label'))).toStrictEqual([
      '移动',
      '测距',
      '区划定位'
    ]);
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(1);
    expect(button(wrapper, '区划定位').findAll('br')).toHaveLength(1);
    expect(button(wrapper, '区划定位').text()).toBe('区划定位');
  });

  it('"点/框选"在按钮上不换行', () => {
    const { wrapper } = mountToolbar([[FEATURE_PICK_TOOL]]);

    expect(button(wrapper, '点/框选').findAll('br')).toHaveLength(0);
    expect(button(wrapper, '点/框选').text()).toBe('点/框选');
  });

  it('只显示图标时不渲染文字，名称交给提示和无障碍名称', () => {
    const { wrapper } = mountToolbar([['browse', 'region-locate']], {}, [], true);

    expect(button(wrapper, '区划定位').text()).toBe('');
    expect(wrapper.find('[class*="_label_"]').exists()).toBe(false);
  });

  it('工具按钮跟随当前工具；点击没有激活的工具时激活它', async () => {
    const { wrapper, map } = mountToolbar([['browse']]);
    expect(isActive(wrapper, '移动')).toBe(true);
    expect(button(wrapper, '移动').attributes('aria-pressed')).toBe('true');

    map.activateTool('probe');
    await nextTick();
    expect(isActive(wrapper, '移动')).toBe(false);

    await button(wrapper, '移动').trigger('click');

    expect(map.activeTool.value).toBe('browse');
    expect(isActive(wrapper, '移动')).toBe(true);
  });

  it('点击已激活的工具时退出，回到常驻的"移动"', async () => {
    const { wrapper, map } = mountToolbar([['browse', 'measure-distance']]);

    await button(wrapper, '测距').trigger('click');
    expect(map.activeTool.value).toBe('measure-distance');
    expect(isActive(wrapper, '测距')).toBe(true);

    await button(wrapper, '测距').trigger('click');

    expect(map.activeTool.value).toBe('browse');
    expect(isActive(wrapper, '测距')).toBe(false);
  });

  it('动作按钮调用页面的回调；没有回调时不可用', async () => {
    const clear = vi.fn<() => void>();
    const withAction = mountToolbar([['clear']], { clear });
    const withoutAction = mountToolbar([['clear']]);

    await button(withAction.wrapper, '清除').trigger('click');

    expect(clear).toHaveBeenCalledOnce();
    expect(button(withoutAction.wrapper, '清除').attributes('disabled')).toBeDefined();
  });

  it('页面告诉工具栏哪些动作显示为按下，样式和当前工具不同', () => {
    const toggle = vi.fn<() => void>();
    const { wrapper } = mountToolbar([['region-locate', 'clear']], { 'region-locate': toggle, clear: toggle }, [
      'region-locate'
    ]);

    expect(isPressed(wrapper, '区划定位')).toBe(true);
    expect(isActive(wrapper, '区划定位')).toBe(false);
    expect(button(wrapper, '区划定位').attributes('aria-pressed')).toBe('true');
    expect(isPressed(wrapper, '清除')).toBe(false);
    expect(button(wrapper, '清除').attributes('aria-pressed')).toBe('false');
  });
});
