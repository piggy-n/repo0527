import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';
import { ElSlider } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { useBoundaries } from '../boundary/useBoundaries';
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

function mountWithBoundaries() {
  const boundaries = useBoundaries();
  const open = ref(false);
  const visible = ref(true);
  const camera: CameraState = { center: [119.4, 32.9], zoom: 10, bearing: 0, pitch: 0 };
  const Page = defineComponent(() => {
    provideMap({ groups: ['basemap'], camera });
    return () => (
      <MapViewControls
        goToDefaultView={() => undefined}
        zoomRange={RANGE}
        boundaries={boundaries}
        boundariesOpen={open.value}
        boundariesVisible={visible.value}
        onUpdate:boundariesOpen={value => (open.value = value)}
      />
    );
  });
  return { wrapper: mount(Page, { attachTo: document.body }), boundaries, open, visible };
}

const entry = (wrapper: VueWrapper) => button(wrapper, '行政区边界');
const popover = () => {
  const element = document.querySelector('[data-map-options="boundaries"]');
  return element instanceof HTMLElement ? new DOMWrapper(element) : null;
};
const popoverShown = () => popover()?.isVisible() === true;

describe('MapViewControls', () => {
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

  it('页面不给当前视图（不支持三维）时没有 2D/3D，默认视角是最后一段、后面没有分隔线（ADR 0111）', () => {
    const { wrapper } = mountControls(10);

    const labels = wrapper.findAll('button').map(item => item.attributes('aria-label'));
    expect(labels).toStrictEqual(['放大', '缩小', '指北针：恢复正北、垂直俯视', '默认视角']);
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(2);
    expect(wrapper.get('[role="toolbar"]').element.lastElementChild?.getAttribute('aria-label')).toBe('默认视角');
  });

  it('页面给出当前视图时两个按钮都可用：点另一个通知切换，点当前的不通知', async () => {
    const camera: CameraState = { center: [119.4, 32.9], zoom: 10, bearing: 0, pitch: 0 };
    const changed = vi.fn<(value: string) => void>();
    const Page = defineComponent(() => {
      provideMap({ groups: ['basemap'], camera });
      return () => (
        <MapViewControls
          goToDefaultView={() => undefined}
          zoomRange={RANGE}
          dimension="3d"
          onUpdate:dimension={changed}
        />
      );
    });
    const wrapper = mount(Page);

    expect(button(wrapper, '三维').attributes('aria-pressed')).toBe('true');
    expect(button(wrapper, '三维').attributes('aria-disabled')).toBeUndefined();
    await button(wrapper, '三维').trigger('click');
    expect(changed).not.toHaveBeenCalled();
    await button(wrapper, '二维').trigger('click');
    expect(changed).toHaveBeenCalledExactlyOnceWith('2d');
  });

  it('不显示默认视角时（地下空间，ADR 0084）连同它下面的分隔线一起去掉，其余照常', () => {
    const camera: CameraState = { center: [119.4, 32.9], zoom: 10, bearing: 0, pitch: 0 };
    const Page = defineComponent(() => {
      provideMap({ groups: ['basemap'], camera });
      return () => (
        <MapViewControls goToDefaultView={() => undefined} zoomRange={RANGE} dimension="3d" defaultView={false} />
      );
    });
    const wrapper = mount(Page);

    const labels = wrapper.findAll('button').map(item => item.attributes('aria-label'));
    expect(labels).toStrictEqual(['放大', '缩小', '指北针：恢复正北、垂直俯视', '二维', '三维']);
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(2);
  });

  describe('行政区边界（ADR 0128）', () => {
    afterEach(() => {
      // 浮层挂在 body 下，不随组件卸载
      document.body.innerHTML = '';
    });

    it('不给拥有者时没有入口（现状底图的入口在业务组）', () => {
      expect(mountControls(10).wrapper.find('button[aria-label="行政区边界"]').exists()).toBe(false);
    });

    it('入口在指北针和默认视角之间，各自隔一条分隔线', () => {
      const { wrapper } = mountWithBoundaries();

      const labels = wrapper.findAll('button').map(item => item.attributes('aria-label'));
      expect(labels).toStrictEqual(['放大', '缩小', '指北针：恢复正北、垂直俯视', '行政区边界', '默认视角']);
      expect(wrapper.findAll('[role="separator"]')).toHaveLength(3);
      expect(entry(wrapper).attributes('aria-pressed')).toBe('false');
    });

    it('点入口打开浮层，显示省、市、县，勾选改拥有者；再点关闭，勾选还在', async () => {
      const { wrapper, boundaries, open } = mountWithBoundaries();

      await entry(wrapper).trigger('click');
      expect(open.value).toBe(true);
      expect(entry(wrapper).attributes('aria-pressed')).toBe('true');
      await vi.waitFor(() => expect(popoverShown()).toBe(true));
      const content = popover();
      expect(content?.findAll('label').map(label => label.text())).toStrictEqual(['省', '市', '县']);
      await content?.get('label[aria-label="县界"] input').setValue(true);
      expect(boundaries.visible.value).toStrictEqual({ province: true, city: false, county: true });

      await entry(wrapper).trigger('click');
      expect(open.value).toBe(false);
      expect(entry(wrapper).attributes('aria-pressed')).toBe('false');
      expect(boundaries.visible.value.county).toBe(true);
    });

    it('没有操作栏；透明度入口和勾选同一行：默认收起，点开后拖动改拥有者；Esc 关闭浮层', async () => {
      const { wrapper, boundaries, open } = mountWithBoundaries();
      await entry(wrapper).trigger('click');
      await vi.waitFor(() => expect(popoverShown()).toBe(true));
      expect(popover()?.find('.el-slider').exists()).toBe(false);

      await popover()?.get('button[aria-label="调整行政区边界透明度"]').trigger('click');
      wrapper.getComponent(ElSlider).vm.$emit('update:modelValue', 40);
      await nextTick();
      expect(boundaries.opacity.value).toBe(0.4);
      expect(popover()?.text()).toContain('40%');

      expect(popover()?.find('button[aria-label="关闭行政区边界"]').exists()).toBe(false);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextTick();
      expect(open.value).toBe(false);
    });

    it('让给另一边时不显示为按下、只标主色；这时点入口是重新显示，不是关闭', async () => {
      const { wrapper, open, visible } = mountWithBoundaries();
      await entry(wrapper).trigger('click');

      visible.value = false;
      await nextTick();
      expect(entry(wrapper).attributes('aria-pressed')).toBe('false');
      expect(entry(wrapper).classes().join(' ')).toContain('_opened_');

      await entry(wrapper).trigger('click');
      expect(open.value).toBe(true);
    });
  });
});
