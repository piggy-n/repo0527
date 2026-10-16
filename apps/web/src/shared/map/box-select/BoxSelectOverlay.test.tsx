import type { ScreenBox } from '@yzt/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { BoxSelectOverlay, boxStyle } from './BoxSelectOverlay';

describe('BoxSelectOverlay', () => {
  it('没有框和提示时只有空的浮层', () => {
    const wrapper = mount(BoxSelectOverlay, { props: { box: null, hint: null } });

    expect(wrapper.get('[data-box-select-overlay]').element.children).toHaveLength(0);
  });

  it('框按左上角和宽高摆放，起点在右下也一样', () => {
    const box: ScreenBox = { from: { x: 120, y: 80 }, to: { x: 20, y: 30 } };
    const wrapper = mount(BoxSelectOverlay, { props: { box } });

    const element = wrapper.get('[data-box-select-overlay] [data-box]').element as HTMLElement;
    expect([element.style.left, element.style.top, element.style.width, element.style.height]).toStrictEqual([
      '20px',
      '30px',
      '100px',
      '50px'
    ]);
    expect(boxStyle({ from: { x: 20, y: 30 }, to: { x: 120, y: 80 } })).toStrictEqual(boxStyle(box));
  });

  it('鼠标旁的提示放在指针的位置，逐行显示', () => {
    const hint = { point: { x: 40, y: 50 }, lines: ['单击查看要素，拖动框选', '按住 Ctrl 拖动地图'] };
    const wrapper = mount(BoxSelectOverlay, { props: { box: null, hint } });

    const element = wrapper.get('[data-box-select-overlay] [data-pointer-hint]');
    const { left, top } = (element.element as HTMLElement).style;
    expect([left, top]).toStrictEqual(['40px', '50px']);
    expect(element.findAll('span').map(line => line.text())).toStrictEqual(hint.lines);
    expect(wrapper.find('[data-box]').exists()).toBe(false);
  });
});
