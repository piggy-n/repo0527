import { type DOMWrapper, mount } from '@vue/test-utils';
import { ElSlider } from 'element-plus';
import { describe, expect, it } from 'vitest';
import { BoundaryPanel } from './BoundaryPanel';
import { useBoundaries } from './useBoundaries';

function checkbox(wrapper: ReturnType<typeof mount>, label: string): DOMWrapper<HTMLInputElement> {
  const found = wrapper.findAll('label').find(candidate => candidate.text() === label);
  if (!found) {
    throw new Error(`没有找到"${label}"`);
  }
  return found.find('input');
}

// 联调用的界面只测关键交互：勾选级别、拖动透明度，状态由 useBoundaries 持有
describe('BoundaryPanel', () => {
  it('勾选、取消某一级后改变状态；都不勾选时没有透明度', async () => {
    const boundaries = useBoundaries();
    const wrapper = mount(BoundaryPanel, { props: { boundaries } });

    expect(wrapper.findAll('label').map(label => label.text())).toStrictEqual(['省界', '市界', '县界']);
    expect(checkbox(wrapper, '省界').element.checked).toBe(true);

    await checkbox(wrapper, '县界').setValue(true);
    expect(boundaries.visible.value).toStrictEqual({ province: true, city: false, county: true });

    await checkbox(wrapper, '省界').setValue(false);
    await checkbox(wrapper, '县界').setValue(false);
    expect(boundaries.visible.value).toStrictEqual({ province: false, city: false, county: false });
    expect(wrapper.find('.el-slider').exists()).toBe(false);
  });

  it('滑块按百分比显示，拖动时把 0～1 的透明度交给拥有者', async () => {
    const boundaries = useBoundaries();
    boundaries.setOpacity(0.6);
    const wrapper = mount(BoundaryPanel, { props: { boundaries } });
    const slider = wrapper.findComponent(ElSlider);

    expect(slider.props('modelValue')).toBe(60);

    expect(() => slider.vm.$emit('update:modelValue', 35)).not.toThrow();
    await wrapper.vm.$nextTick();

    expect(boundaries.opacity.value).toBe(0.35);
    expect(slider.props('modelValue')).toBe(35);
  });
});
