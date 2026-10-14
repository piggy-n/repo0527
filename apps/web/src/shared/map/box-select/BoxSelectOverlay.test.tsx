import type { ScreenBox } from '@yzt/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { BoxSelectOverlay, boxStyle } from './BoxSelectOverlay';

describe('BoxSelectOverlay', () => {
  it('没有框时只有空的浮层', () => {
    const wrapper = mount(BoxSelectOverlay, { props: { box: null } });

    expect(wrapper.get('[data-box-select-overlay]').element.children).toHaveLength(0);
  });

  it('框按左上角和宽高摆放，起点在右下也一样', () => {
    const box: ScreenBox = { from: { x: 120, y: 80 }, to: { x: 20, y: 30 } };
    const wrapper = mount(BoxSelectOverlay, { props: { box } });

    const element = wrapper.get('[data-box-select-overlay] > div').element as HTMLElement;
    expect([element.style.left, element.style.top, element.style.width, element.style.height]).toStrictEqual([
      '20px',
      '30px',
      '100px',
      '50px'
    ]);
    expect(boxStyle({ from: { x: 20, y: 30 }, to: { x: 120, y: 80 } })).toStrictEqual(boxStyle(box));
  });
});
