import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MapCard } from './MapCard';

describe('MapCard', () => {
  it('图标加文字；点击时通知页面，面板开着时显示为按下', async () => {
    const wrapper = mount(MapCard, {
      props: { label: '图例' },
      slots: { icon: () => <i data-icon /> }
    });
    const button = wrapper.get('button');

    expect(button.text()).toBe('图例');
    expect(wrapper.find('[data-icon]').exists()).toBe(true);
    expect(button.attributes('aria-pressed')).toBe('false');

    await button.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);

    await wrapper.setProps({ pressed: true });
    expect(button.attributes('aria-pressed')).toBe('true');
  });

  it('铺满一张图时，文字压在图的底部', () => {
    const wrapper = mount(MapCard, {
      props: { label: '底图', pressed: true },
      slots: { cover: () => <span data-cover /> }
    });
    const button = wrapper.get('button');

    expect(button.text()).toBe('底图');
    // 图在文字前面，文字在最后（压在底部）
    expect(button.element.firstElementChild?.querySelector('[data-cover]')).not.toBeNull();
    expect(button.element.lastElementChild?.textContent).toBe('底图');
    expect(button.attributes('aria-pressed')).toBe('true');
  });
});
