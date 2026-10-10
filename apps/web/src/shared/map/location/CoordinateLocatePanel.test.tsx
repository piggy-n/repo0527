import type { CameraState, LngLat } from '@yzt/map-core';
import { type MapHandle, provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { CoordinateLocatePanel } from './CoordinateLocatePanel';
import { LOCATION_PICK_TOOL, type LocationPointOwner, useLocationPoint } from './useLocationPoint';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

/** 页面创建地图和位置点，渲染面板；没有画布，定位只放下位置点 */
function mountPanel(initial?: LngLat) {
  let owner: LocationPointOwner | undefined;
  let handle: MapHandle<'basemap'> | undefined;
  const onClose = vi.fn<() => void>();
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['basemap'], camera: CAMERA });
    const location = useLocationPoint(map, { regions: { districtCodeAt: () => Promise.resolve(null) } });
    map.registerTools(location.tools);
    if (initial) {
      location.place(initial, 'drag');
    }
    owner = location;
    handle = map;
    return () => <CoordinateLocatePanel location={location} onClose={onClose} />;
  });
  const wrapper = mount(Page);
  if (!owner || !handle) {
    throw new Error('页面没有创建位置点');
  }
  return { wrapper, location: owner, map: handle, onClose };
}

const field = (wrapper: VueWrapper, label: string) => wrapper.get(`input[aria-label="${label}"]`);
const valueOf = (wrapper: VueWrapper, label: string) => (field(wrapper, label).element as HTMLInputElement).value;

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find(candidate => candidate.text() === text);
  if (!found) {
    throw new Error(`没有"${text}"按钮`);
  }
  return found;
}

async function type(wrapper: VueWrapper, label: string, value: string) {
  await field(wrapper, label).setValue(value);
  await field(wrapper, label).trigger('blur');
}

describe('CoordinateLocatePanel', () => {
  it('空白的输入框在点"定位"之前不提示', () => {
    const { wrapper } = mountPanel();

    expect(wrapper.text()).not.toContain('请输入');
  });

  it('打开时显示已有的位置点；默认度分秒', () => {
    const { wrapper } = mountPanel([118.79786, 32.04864]);

    expect(valueOf(wrapper, '经度')).toBe('118°47′52.30″');
    expect(valueOf(wrapper, '纬度')).toBe('32°02′55.10″');
    expect(field(wrapper, '经度').attributes('placeholder')).toBe('如 118°46′40″ 或 1184640');
  });

  it('输入时下方显示识别结果，离开输入框时规范成标准写法；认不出来的显示原因并保留原文', async () => {
    const { wrapper } = mountPanel();

    await field(wrapper, '经度').setValue('1184752.3');
    expect(wrapper.text()).toContain('= 118°47′52.30″');
    await field(wrapper, '经度').trigger('blur');
    expect(valueOf(wrapper, '经度')).toBe('118°47′52.30″');
    expect(wrapper.text()).not.toContain('= 118°47′52.30″');

    await type(wrapper, '纬度', 'abc');
    expect(valueOf(wrapper, '纬度')).toBe('abc');
    expect(wrapper.text()).toContain('无法识别，可以写成 32°03′23″、32 3 23 或 320323');
  });

  it('切换成小数：输入框换成小数写法，记在拥有者里；占位提示跟着换', async () => {
    const { wrapper, location } = mountPanel([118.79786, 32.04864]);

    await wrapper.get('input[value="decimal"]').setValue(true);

    expect(location.state.value.format).toBe('decimal');
    expect(valueOf(wrapper, '经度')).toBe('118.797861');
    expect(field(wrapper, '经度').attributes('placeholder')).toBe('如 118.777800');
  });

  it('一次粘贴一对坐标到经度框，分到两个框', async () => {
    const { wrapper } = mountPanel();

    await type(wrapper, '经度', '118.79786, 32.04864');

    expect(valueOf(wrapper, '经度')).toBe('118°47′52.30″');
    expect(valueOf(wrapper, '纬度')).toBe('32°02′55.10″');
  });

  it('纬度超出范围而经度不超过 90 时提示填反了', async () => {
    const { wrapper } = mountPanel();

    await type(wrapper, '经度', '32.05');
    await type(wrapper, '纬度', '118.79');

    expect(wrapper.text()).toContain('纬度超出范围，经纬度可能填反了');
  });

  it('点"定位"：按输入的原值放下位置点，规范写法只用于显示', async () => {
    const { wrapper, location } = mountPanel();

    await field(wrapper, '经度').setValue('118.79786');
    await field(wrapper, '纬度').setValue('32.04864');
    await button(wrapper, '定位').trigger('click');

    expect(location.state.value.point).toStrictEqual({ lngLat: [118.79786, 32.04864], source: 'input' });
    expect(valueOf(wrapper, '经度')).toBe('118°47′52.30″');
  });

  it('点"定位"时有空白的输入框：提示，不放点；之后识别得了时提示消失', async () => {
    const { wrapper, location } = mountPanel();

    await field(wrapper, '经度').setValue('118.79786');
    await button(wrapper, '定位').trigger('click');
    expect(wrapper.text()).toContain('请输入纬度');
    expect(location.state.value.point).toBeNull();

    await field(wrapper, '纬度').setValue('32.04864');
    await button(wrapper, '定位').trigger('click');

    expect(location.state.value.point?.source).toBe('input');
    expect(wrapper.text()).not.toContain('请输入纬度');
    // 定位成功后重新开始：清空输入框不马上提示
    await field(wrapper, '经度').setValue('');
    expect(wrapper.text()).not.toContain('请输入经度');
  });

  it('回车定位；输入法选字时的回车不算', async () => {
    const { wrapper, location } = mountPanel();
    await field(wrapper, '经度').setValue('118.79786');
    await field(wrapper, '纬度').setValue('32.04864');

    await field(wrapper, '纬度').trigger('keydown', { key: 'Enter', isComposing: true });
    expect(location.state.value.point).toBeNull();
    await field(wrapper, '纬度').trigger('keydown', { key: 'Enter' });

    expect(location.state.value.point?.lngLat).toStrictEqual([118.79786, 32.04864]);
  });

  it('"拾取"开关拾取工具，拾取中显示为按下；关闭按钮通知页面', async () => {
    const { wrapper, map, onClose } = mountPanel();

    await button(wrapper, '拾取').trigger('click');
    expect(map.activeTool.value).toBe(LOCATION_PICK_TOOL);
    expect(button(wrapper, '拾取').attributes('aria-pressed')).toBe('true');
    await button(wrapper, '拾取').trigger('click');
    expect(map.activeTool.value).toBe('browse');

    await wrapper.get('[aria-label="关闭坐标定位"]').trigger('click');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('面板卸载时取消拾取', async () => {
    const { wrapper, map } = mountPanel();
    await button(wrapper, '拾取').trigger('click');

    wrapper.unmount();
    await nextTick();

    expect(map.activeTool.value).toBe('browse');
  });
});
