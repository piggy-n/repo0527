import type { ScreenBox } from '@yzt/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick, shallowRef } from 'vue';
import type { PointerHintContent } from '../pointer-hint/pointer-hint';
import { BoxSelectOverlay, boxStyle } from './BoxSelectOverlay';

describe('BoxSelectOverlay', () => {
  it('没有框和提示时只有空的浮层', () => {
    const pick = { boxDraft: shallowRef<ScreenBox | null>(null), hint: shallowRef<PointerHintContent | null>(null) };
    const wrapper = mount(BoxSelectOverlay, { props: { pick } });

    expect(wrapper.get('[data-box-select-overlay]').element.children).toHaveLength(0);
  });

  it('框按左上角和宽高摆放，起点在右下也一样', () => {
    const box: ScreenBox = { from: { x: 120, y: 80 }, to: { x: 20, y: 30 } };
    const pick = { boxDraft: shallowRef(box), hint: shallowRef<PointerHintContent | null>(null) };
    const wrapper = mount(BoxSelectOverlay, { props: { pick } });

    const element = wrapper.get('[data-box-select-overlay] [data-box]').element as HTMLElement;
    expect([element.style.left, element.style.top, element.style.width, element.style.height]).toStrictEqual([
      '20px',
      '30px',
      '100px',
      '50px'
    ]);
    expect(boxStyle({ from: { x: 20, y: 30 }, to: { x: 120, y: 80 } })).toStrictEqual(boxStyle(box));
  });

  it('鼠标旁的提示放在指针的位置，逐行显示；同一拥有者内的状态变化会更新浮层', async () => {
    const hint = { point: { x: 40, y: 50 }, lines: ['单击查看要素，拖动框选', '按住 Ctrl 拖动地图'] };
    const pick = { boxDraft: shallowRef<ScreenBox | null>(null), hint: shallowRef<PointerHintContent | null>(hint) };
    const wrapper = mount(BoxSelectOverlay, { props: { pick } });

    const element = wrapper.get('[data-box-select-overlay] [data-pointer-hint]');
    const { left, top } = (element.element as HTMLElement).style;
    expect([left, top]).toStrictEqual(['40px', '50px']);
    expect(element.findAll('span').map(line => line.text())).toStrictEqual(hint.lines);
    expect(wrapper.find('[data-box]').exists()).toBe(false);

    pick.hint.value = null;
    pick.boxDraft.value = { from: { x: 10, y: 20 }, to: { x: 60, y: 80 } };
    await nextTick();
    expect(wrapper.find('[data-pointer-hint]').exists()).toBe(false);
    const box = wrapper.get('[data-box]').element as HTMLElement;
    expect([box.style.left, box.style.top, box.style.width, box.style.height])
      .toStrictEqual(['10px', '20px', '50px', '60px']);
  });
});
