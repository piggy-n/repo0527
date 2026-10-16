import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MapCard } from './MapCard';

describe('MapCard', () => {
  it('上面是图标，下面是文字；点击时通知页面，面板开着时显示为按下', async () => {
    const wrapper = mount(MapCard, {
      props: { label: '图例' },
      slots: { icon: () => <i data-icon /> }
    });
    const button = wrapper.get('button');

    expect(button.text()).toBe('图例');
    // 图在上、字在下：两张卡片结构相同，文字在同一条线上（ADR 0057）
    expect(button.element.firstElementChild?.querySelector('[data-icon]')).not.toBeNull();
    expect(button.element.lastElementChild?.textContent).toBe('图例');
    expect(button.attributes('aria-label')).toBeUndefined();
    expect(button.attributes('aria-pressed')).toBe('false');

    await button.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);

    await wrapper.setProps({ pressed: true });
    expect(button.attributes('aria-pressed')).toBe('true');
  });

  it('铺满的图放在同一个位置，文字在下面；文字只写简称时无障碍名称用全称', () => {
    const wrapper = mount(MapCard, {
      props: { label: '矢量', name: '底图：矢量底图', pressed: true },
      slots: { cover: () => <span data-cover /> }
    });
    const button = wrapper.get('button');

    expect(button.text()).toBe('矢量');
    expect(button.element.firstElementChild?.querySelector('[data-cover]')).not.toBeNull();
    expect(button.element.lastElementChild?.textContent).toBe('矢量');
    expect(button.attributes('aria-label')).toBe('底图：矢量底图');
    expect(button.attributes('aria-pressed')).toBe('true');
  });
});
