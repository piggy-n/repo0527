import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import type { RegionBoundary, RegionBoundaryLoader } from './region-geometry';
import { RegionLocatePanel } from './RegionLocatePanel';
import { type RegionLocate, useRegionLocate } from './useRegionLocate';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

function boundaryOf(code: string): RegionBoundary {
  return { code, geometry: { type: 'Polygon', coordinates: [[[118, 31]]] }, bounds: [118, 31, 119, 32] };
}

/** 页面创建地图和区划定位，渲染面板；没有画布，选中后只加载边界、不定位 */
function mountPanel(load: RegionBoundaryLoader['load'] = ({ code }) => Promise.resolve(boundaryOf(code))) {
  let owner: RegionLocate | undefined;
  const onClose = vi.fn<() => void>();
  const loader = { load: vi.fn<RegionBoundaryLoader['load']>(load) };
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['region'], camera: CAMERA });
    owner = useRegionLocate(map, { goToDefaultView: () => {}, loader });
    map.bindStyle({ region: owner.deriveGroup });
    const region = owner;
    return () => <RegionLocatePanel region={region} onClose={onClose} />;
  });
  const wrapper = mount(Page);
  if (!owner) {
    throw new Error('页面没有创建区划定位');
  }
  return { wrapper, region: owner, loader, onClose };
}

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find(candidate => candidate.text() === text);
  if (!found) {
    throw new Error(`没有"${text}"按钮`);
  }
  return found;
}

const isPrimary = (wrapper: VueWrapper, text: string) => button(wrapper, text).classes().includes('el-button--primary');

const current = (wrapper: VueWrapper) => wrapper.get('[data-region-locate-panel]').find('span + span').text();

afterEach(() => {
  vi.useRealTimers();
});

describe('RegionLocatePanel', () => {
  it('列出 13 个市（不带"市"字）；开始时是全省，没有区县', () => {
    const { wrapper } = mountPanel();

    expect(current(wrapper)).toBe('全省');
    expect(button(wrapper, '南京').exists()).toBe(true);
    expect(button(wrapper, '宿迁').exists()).toBe(true);
    expect(wrapper.findAll('button').some(candidate => candidate.text() === '玄武区')).toBe(false);
  });

  it('点市选中并列出它的区县；点区县选中，所在的市仍是选中；再点区县回到市，再点市回到全省', async () => {
    const { wrapper, region } = mountPanel();

    await button(wrapper, '南京').trigger('click');
    expect(region.state.value.selected?.code).toBe('320100');
    expect(current(wrapper)).toBe('南京市');
    expect(isPrimary(wrapper, '南京')).toBe(true);

    await button(wrapper, '玄武区').trigger('click');
    expect(current(wrapper)).toBe('南京市 / 玄武区');
    expect(isPrimary(wrapper, '玄武区')).toBe(true);
    expect(isPrimary(wrapper, '南京')).toBe(true);

    await button(wrapper, '玄武区').trigger('click');
    expect(region.state.value.selected?.code).toBe('320100');

    await button(wrapper, '南京').trigger('click');
    expect(region.state.value.selected).toBeNull();
    expect(current(wrapper)).toBe('全省');
  });

  it('搜索：输入后列出路径，点一条选中它并清空关键字', async () => {
    const { wrapper, region } = mountPanel();

    await wrapper.get('input').setValue('鼓楼');
    const results = wrapper.findAll('li').map(item => item.text());
    expect(results).toStrictEqual(['南京市 / 鼓楼区', '徐州市 / 鼓楼区']);

    await button(wrapper, '徐州市 / 鼓楼区').trigger('click');

    expect(region.state.value.selected?.code).toBe('320302');
    expect(wrapper.get('input').element.value).toBe('');
    expect(wrapper.findAll('li')).toHaveLength(0);
  });

  it('回车或点"搜索"选中第一条；输入法选字时的回车不算', async () => {
    const { wrapper, region } = mountPanel();
    const input = wrapper.get('input');

    await input.setValue('苏州');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(region.state.value.selected).toBeNull();
    await input.trigger('keydown', { key: 'Enter' });
    expect(region.state.value.selected?.code).toBe('320500');

    await input.setValue('无锡');
    await button(wrapper, '搜索').trigger('click');
    expect(region.state.value.selected?.code).toBe('320200');
  });

  it('加载边界超过 300ms 才显示"正在加载"', async () => {
    vi.useFakeTimers();
    const { wrapper } = mountPanel(() => new Promise(() => {}));

    await button(wrapper, '南京').trigger('click');
    expect(wrapper.text()).not.toContain('正在加载边界');

    vi.advanceTimersByTime(300);
    await nextTick();
    expect(wrapper.text()).toContain('正在加载边界');
  });

  it('加载失败时显示失败和"重试"，重试时重新加载', async () => {
    const { wrapper, loader } = mountPanel(() => Promise.reject(new Error('断网')));

    await button(wrapper, '南京').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain('边界加载失败');

    await button(wrapper, '重试').trigger('click');
    expect(loader.load).toHaveBeenCalledTimes(2);
  });

  it('点关闭按钮通知页面关闭面板', async () => {
    const { wrapper, onClose } = mountPanel();

    await wrapper.get('[aria-label="关闭区划定位"]').trigger('click');

    expect(onClose).toHaveBeenCalledOnce();
  });
});
