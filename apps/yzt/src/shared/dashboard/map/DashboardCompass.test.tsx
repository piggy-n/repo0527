import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { DashboardCompass } from './DashboardCompass';

describe('DashboardCompass', () => {
  it('旋转只写在里面的 svg 上，外层的变换留给入场动画；正北朝上时不写变换', async () => {
    const wrapper = mount(DashboardCompass, { props: { rotation: 30 } });
    expect(wrapper.attributes('aria-label')).toBe('指北针');
    expect(wrapper.get('svg').element.style.transform).toBe('rotate(30deg)');
    expect((wrapper.element as HTMLElement).style.transform).toBe('');
    await wrapper.setProps({ rotation: 0 });
    expect(wrapper.get('svg').element.style.transform).toBe('');
  });
});
