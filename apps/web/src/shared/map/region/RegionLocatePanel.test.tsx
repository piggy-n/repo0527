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
  const loader = { load: vi.fn<RegionBoundaryLoader['load']>(load) };
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['region'], camera: CAMERA });
    owner = useRegionLocate(map, { goToDefaultView: () => {}, loader });
    map.bindStyle({ region: owner.deriveGroup });
    const region = owner;
    return () => <RegionLocatePanel region={region} />;
  });
  const wrapper = mount(Page);
  if (!owner) {
    throw new Error('页面没有创建区划定位');
  }
  return { wrapper, region: owner, loader };
}

// 按文字或无障碍名称找按钮：格子、当前位置的上一级按文字，搜索结果按路径
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper
    .findAll('button')
    .find(candidate => candidate.text() === text || candidate.attributes('aria-label') === text);
  if (!found) {
    throw new Error(`没有"${text}"按钮`);
  }
  return found;
}

const isPressed = (wrapper: VueWrapper, text: string) => button(wrapper, text).attributes('aria-pressed') === 'true';

// 当前位置里能点的上一级；最后一级是当前选中的，不能点
const links = (wrapper: VueWrapper) =>
  wrapper
    .get('[data-region-current]')
    .findAll('button')
    .map(item => item.text());

// 当前位置的各级名称
const trail = (wrapper: VueWrapper) =>
  wrapper
    .get('[data-region-current]')
    .findAll('button, [aria-current]')
    .map(item => item.text());

afterEach(() => {
  vi.useRealTimers();
});

describe('RegionLocatePanel', () => {
  it('列出 13 个市（不带"市"字）；开始时是全省，没有区县', () => {
    const { wrapper } = mountPanel();

    // 文案（2026-10-16 用户要求）：搜索框写"区/县"，市的小标题只写"市"
    expect(wrapper.get('input').attributes('placeholder')).toBe('搜索市、区/县');
    expect(wrapper.findAll('div').some(candidate => candidate.text() === '市')).toBe(true);
    expect(wrapper.text()).not.toContain('设区市');

    expect(trail(wrapper)).toStrictEqual(['江苏省']);
    expect(links(wrapper)).toStrictEqual([]);
    expect(button(wrapper, '南京').exists()).toBe(true);
    expect(button(wrapper, '宿迁').exists()).toBe(true);
    expect(wrapper.findAll('button').some(candidate => candidate.text() === '玄武区')).toBe(false);
  });

  it('点市选中并列出它的区县；点区县选中，所在的市仍是选中；再点区县回到市，再点市回到全省', async () => {
    const { wrapper, region } = mountPanel();

    await button(wrapper, '南京').trigger('click');
    expect(region.state.value.selected?.code).toBe('320100');
    expect(trail(wrapper)).toStrictEqual(['江苏省', '南京市']);
    expect(wrapper.text()).toContain('南京市的区/县');
    expect(isPressed(wrapper, '南京')).toBe(true);
    expect(isPressed(wrapper, '无锡')).toBe(false);

    await button(wrapper, '玄武区').trigger('click');
    expect(trail(wrapper)).toStrictEqual(['江苏省', '南京市', '玄武区']);
    expect(links(wrapper)).toStrictEqual(['江苏省', '南京市']);
    expect(isPressed(wrapper, '玄武区')).toBe(true);
    expect(isPressed(wrapper, '南京')).toBe(true);

    await button(wrapper, '玄武区').trigger('click');
    expect(region.state.value.selected?.code).toBe('320100');

    await button(wrapper, '南京').trigger('click');
    expect(region.state.value.selected).toBeNull();
    expect(trail(wrapper)).toStrictEqual(['江苏省']);
  });

  it('当前位置的上一级可以点：点市回到市，点江苏省回到全省', async () => {
    const { wrapper, region } = mountPanel();
    region.select('320102');
    await nextTick();

    await button(wrapper, '南京市').trigger('click');
    expect(region.state.value.selected?.code).toBe('320100');

    await button(wrapper, '江苏省').trigger('click');
    expect(region.state.value.selected).toBeNull();
  });

  it('搜索：输入时换成结果列表，标出关键字；点一条选中它并清空关键字', async () => {
    const { wrapper, region } = mountPanel();

    await wrapper.get('input').setValue('鼓楼');
    const results = wrapper.findAll('li button').map(item => item.attributes('aria-label'));
    expect(results).toStrictEqual(['南京市 / 鼓楼区', '徐州市 / 鼓楼区']);
    expect(wrapper.findAll('mark').map(mark => mark.text())).toStrictEqual(['鼓楼', '鼓楼']);
    expect(wrapper.find('[data-region-current]').exists()).toBe(false);

    await button(wrapper, '徐州市 / 鼓楼区').trigger('click');

    expect(region.state.value.selected?.code).toBe('320302');
    expect(wrapper.get('input').element.value).toBe('');
    expect(wrapper.findAll('li')).toHaveLength(0);
    expect(trail(wrapper)).toStrictEqual(['江苏省', '徐州市', '鼓楼区']);
  });

  it('关键字只在所属的市名里时标在市名上；没有结果时说明', async () => {
    const { wrapper } = mountPanel();

    await wrapper.get('input').setValue('镇江');
    const jingkou = button(wrapper, '镇江市 / 京口区');
    expect(jingkou.find('mark').text()).toBe('镇江');
    expect(jingkou.text()).toBe('京口区镇江市');

    await wrapper.get('input').setValue('北京');
    expect(wrapper.text()).toContain('没有找到"北京"');
  });

  it('回车选中第一条；输入法选字时的回车不算', async () => {
    const { wrapper, region } = mountPanel();
    const input = wrapper.get('input');

    await input.setValue('苏州');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(region.state.value.selected).toBeNull();
    await input.trigger('keydown', { key: 'Enter' });
    expect(region.state.value.selected?.code).toBe('320500');
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
});
