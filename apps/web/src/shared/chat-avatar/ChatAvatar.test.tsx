import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ChatAvatar } from './ChatAvatar';

describe('ChatAvatar', () => {
  it('助手是机器人：图片约占圆底的 72%，取双数（56 → 40、32 → 24）', () => {
    for (const [size, width] of [
      [56, '40px'],
      [32, '24px'],
      [20, '14px']
    ] as const) {
      const wrapper = mount(ChatAvatar, { props: { speaker: 'assistant', size } });
      expect(wrapper.attributes('style')).toContain(`width: ${size}px`);
      expect(wrapper.get('img').element.style.width).toBe(width);
    }
  });

  it('用户是"我"，没有图片；头像只是装饰，读屏跳过', () => {
    const wrapper = mount(ChatAvatar, { props: { speaker: 'user' } });
    expect(wrapper.text()).toBe('我');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.attributes('aria-hidden')).toBe('true');
  });
});
