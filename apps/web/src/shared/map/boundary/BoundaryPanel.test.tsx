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

  it('每一级前面是它在地图上的线型：省界是色带、白边和深蓝的线，市界是白边上的细线，县界是虚线', () => {
    const wrapper = mount(BoundaryPanel, { props: { boundaries: useBoundaries() } });
    // 线型示意在勾选框的 label 里，是叠起来的几条 SVG 线
    const swatch = (label: string) => {
      const svg = checkbox(wrapper, label).element.closest('label')?.querySelector('svg[aria-hidden="true"]');
      if (!svg) {
        throw new Error(`"${label}"没有线型示意`);
      }
      return svg;
    };
    const attributeOf = (label: string, name: string) =>
      [...swatch(label).querySelectorAll('line')].map(line => line.getAttribute(name));

    expect(attributeOf('省界', 'stroke')).toStrictEqual(['#597EF7', '#FFFFFF', '#2F54EB']);
    expect(attributeOf('省界', 'stroke-width')).toStrictEqual(['10', '4.4', '2.4']);
    // 高度放得下最宽的一条（省界的色带），其他两级至少 8
    expect([swatch('省界'), swatch('市界'), swatch('县界')].map(svg => svg.getAttribute('height'))).toStrictEqual([
      '10',
      '8',
      '8'
    ]);
    expect(attributeOf('市界', 'stroke')).toStrictEqual(['#FFFFFF', '#597EF7']);
    // 虚线的线段和间隔按线宽换算：3、2 个线宽，线宽 1.1
    const [dasharray] = attributeOf('县界', 'stroke-dasharray');
    expect(dasharray?.split(' ').map(Number)).toStrictEqual([expect.closeTo(3.3), expect.closeTo(2.2)]);
    expect(attributeOf('省界', 'stroke-dasharray')).toStrictEqual([null, null, null]);
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
