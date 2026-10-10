import { type DOMWrapper, mount } from '@vue/test-utils';
import { ElSlider } from 'element-plus';
import { describe, expect, it } from 'vitest';
import { BasemapPanel } from './BasemapPanel';
import { useBasemap } from './useBasemap';

const TIANDITU = { key: '0123456789abcdef0123456789abcdef' };

function radioInput(wrapper: ReturnType<typeof mount>, label: string): DOMWrapper<HTMLInputElement> {
  const button = wrapper.findAll('label').find(candidate => candidate.text() === label);
  if (!button) {
    throw new Error(`没有找到"${label}"`);
  }
  return button.find('input');
}

// 联调用的界面只测关键交互：选择底图、拖动透明度，状态由 useBasemap 持有
describe('BasemapPanel', () => {
  it('选择底图后改变状态；无底图时没有透明度', async () => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    const wrapper = mount(BasemapPanel, { props: { basemap } });

    expect(wrapper.findAll('label').map(label => label.text())).toStrictEqual(['矢量底图', '影像底图', '无底图']);
    expect(wrapper.find('.el-slider').exists()).toBe(true);

    await radioInput(wrapper, '影像底图').setValue(true);
    expect(basemap.selected.value).toBe('imagery');

    await radioInput(wrapper, '无底图').setValue(true);
    expect(basemap.selected.value).toBe('none');
    expect(wrapper.find('.el-slider').exists()).toBe(false);
  });

  it('滑块按百分比显示，拖动时把 0～1 的透明度交给拥有者', async () => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    basemap.setOpacity(0.6);
    const wrapper = mount(BasemapPanel, { props: { basemap } });
    const slider = wrapper.findComponent(ElSlider);

    expect(slider.props('modelValue')).toBe(60);

    expect(() => slider.vm.$emit('update:modelValue', 35)).not.toThrow();
    await wrapper.vm.$nextTick();

    expect(basemap.opacity.value).toBe(0.35);
    expect(slider.props('modelValue')).toBe(35);
  });

  it('关闭天地图时只有"无底图"', () => {
    const wrapper = mount(BasemapPanel, { props: { basemap: useBasemap({ tianditu: null }) } });

    expect(wrapper.findAll('label').map(label => label.text())).toStrictEqual(['无底图']);
    expect(wrapper.find('.el-slider').exists()).toBe(false);
  });
});
