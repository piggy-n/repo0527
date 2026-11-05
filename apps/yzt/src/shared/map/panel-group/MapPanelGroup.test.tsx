import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, KeepAlive, nextTick, onBeforeUnmount, type PropType, ref } from 'vue';
import { MapPanelGroup, type PanelSlotProps } from './MapPanelGroup';
import { type PanelGroup, usePanelGroup } from './usePanelGroup';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };
const ORDER = ['region', 'coordinate', 'detail'] as const;
type Id = (typeof ORDER)[number];
const LABELS = { region: '区划定位', coordinate: '坐标定位', detail: '资源详情' };

// 记下自己是否在显示、卸载过几次的内容
const Content = defineComponent({
  props: {
    name: { type: String, required: true },
    active: { type: Boolean, required: true },
    onUnmount: { type: Function as PropType<() => void>, required: true }
  },
  setup(props) {
    const typed = ref('');
    onBeforeUnmount(props.onUnmount);
    return () => (
      <div data-content={props.name} data-active={String(props.active)}>
        <input value={typed.value} onInput={event => (typed.value = (event.target as HTMLInputElement).value)} />
      </div>
    );
  }
});

function mountGroup(visible = ref(true)) {
  let group: PanelGroup<Id> | undefined;
  const unmounted = vi.fn<(name: string) => void>();
  const onClose = vi.fn<(id: string) => void>();
  const slot = (name: string) => ({ active }: PanelSlotProps) => [
    <Content name={name} active={active} onUnmount={() => unmounted(name)} />
  ];
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: CAMERA });
    const owned = usePanelGroup(ORDER);
    group = owned;
    return () => (
      <MapPanelGroup group={owned} labels={LABELS} visible={visible.value} onClose={onClose}>
        {{ region: slot('region'), coordinate: slot('coordinate'), detail: slot('detail') }}
      </MapPanelGroup>
    );
  });
  const wrapper = mount(Page);
  if (!group) {
    throw new Error('页面没有创建面板组');
  }
  return { wrapper, group, unmounted, onClose, visible };
}

const tabs = (wrapper: VueWrapper) => wrapper.findAll('[role="tab"]').map(tab => tab.text());
const shown = (wrapper: VueWrapper) =>
  wrapper.findAll('[role="tabpanel"]').filter(panel => panel.attributes('style') === undefined).map(panel => panel.attributes('data-panel'));
const active = (wrapper: VueWrapper, name: string) => wrapper.get(`[data-content="${name}"]`).attributes('data-active');

describe('MapPanelGroup', () => {
  it('没有打开的功能时整组隐藏；新打开的 Tab 前置，只显示当前的内容', async () => {
    const { wrapper, group } = mountGroup();
    expect(wrapper.get('[data-panel-group]').attributes('style')).toContain('display: none');

    group.show('detail');
    group.show('region');
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-panel-group]').attributes('style')).toBeUndefined();
    expect(tabs(wrapper)).toStrictEqual(['区划定位', '资源详情']);
    expect(wrapper.get('[aria-selected="true"]').text()).toBe('区划定位');
    expect(shown(wrapper)).toStrictEqual(['region']);
    // 没在显示的内容也挂载着
    expect(wrapper.find('[data-content="detail"]').exists()).toBe(true);
    expect(active(wrapper, 'region')).toBe('true');
    expect(active(wrapper, 'detail')).toBe('false');
  });

  it('点 Tab 切换：切走的内容隐藏但不卸载，输入保留，active 变为 false', async () => {
    const { wrapper, group, unmounted } = mountGroup();
    group.show('coordinate');
    group.show('region');
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-content="region"] input').setValue('南京');

    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === '坐标定位')?.trigger('click');

    expect(unmounted).not.toHaveBeenCalled();
    expect(shown(wrapper)).toStrictEqual(['coordinate']);
    expect(active(wrapper, 'region')).toBe('false');
    expect((wrapper.get('[data-content="region"] input').element as HTMLInputElement).value).toBe('南京');
    expect(tabs(wrapper)).toStrictEqual(['区划定位', '坐标定位']);
  });

  it('统一关闭卸载所有内容，并逐项通知页面清理', async () => {
    const { wrapper, group, unmounted, onClose } = mountGroup();
    group.show('region');
    group.show('detail');
    await nextTick();
    await wrapper.get('[aria-label="关闭全部功能"]').trigger('click');
    expect(group.state.value.open).toStrictEqual([]);
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false);
    expect(unmounted.mock.calls.map(([id]) => id).toSorted()).toStrictEqual(['detail', 'region']);
    expect(onClose.mock.calls.map(([id]) => id).toSorted()).toStrictEqual(['detail', 'region']);
  });

  it('Tab 上的关闭：从组里关掉、卸载内容、通知页面，切到最近显示过的另一个', async () => {
    const { wrapper, group, unmounted, onClose } = mountGroup();
    group.show('region');
    group.show('detail');
    group.show('coordinate');
    await wrapper.vm.$nextTick();

    await wrapper.get('[aria-label="关闭坐标定位"]').trigger('click');

    expect(group.isOpen('coordinate')).toBe(false);
    expect(unmounted).toHaveBeenCalledWith('coordinate');
    expect(onClose).toHaveBeenCalledWith('coordinate');
    expect(shown(wrapper)).toStrictEqual(['detail']);
  });

  it('让给另一边时整组隐藏、内容都不在显示，打开的功能保留；再显示时恢复', async () => {
    const { wrapper, group, unmounted, visible } = mountGroup();
    group.show('region');
    await wrapper.vm.$nextTick();

    visible.value = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-panel-group]').attributes('style')).toContain('display: none');
    expect(active(wrapper, 'region')).toBe('false');
    expect(group.isOpen('region')).toBe(true);
    expect(unmounted).not.toHaveBeenCalled();

    visible.value = true;
    await wrapper.vm.$nextTick();
    expect(active(wrapper, 'region')).toBe('true');
  });
});

describe('MapPanelGroup 所在页面被缓存（ADR 0063）', () => {
  it('页面停用期间内容的 active 为 false、不卸载；激活后按原来的 Tab 恢复', async () => {
    let group: PanelGroup<Id> | undefined;
    const unmounted = vi.fn<(name: string) => void>();
    const slot = (name: string) => ({ active: isActive }: PanelSlotProps) => [
      <Content name={name} active={isActive} onUnmount={() => unmounted(name)} />
    ];
    const Page = defineComponent({
      name: 'CachedPage',
      setup() {
        provideMap({ groups: [], camera: CAMERA });
        const owned = usePanelGroup(ORDER);
        group = owned;
        return () => (
          <MapPanelGroup group={owned} labels={LABELS}>
            {{ region: slot('region'), coordinate: slot('coordinate'), detail: slot('detail') }}
          </MapPanelGroup>
        );
      }
    });
    const pageShown = ref(true);
    const wrapper = mount(defineComponent(() => () => <KeepAlive>{pageShown.value ? <Page /> : null}</KeepAlive>));
    group?.show('detail');
    group?.show('region');
    await nextTick();
    // 停用后元素离开 wrapper 的树，先拿住
    const region = wrapper.get('[data-content="region"]').element;
    expect(region.getAttribute('data-active')).toBe('true');

    pageShown.value = false;
    await nextTick();
    expect(region.getAttribute('data-active')).toBe('false');
    pageShown.value = true;
    await nextTick();

    expect(region.getAttribute('data-active')).toBe('true');
    expect(wrapper.get('[data-content="detail"]').attributes('data-active')).toBe('false');
    expect(unmounted).not.toHaveBeenCalled();
  });
});
