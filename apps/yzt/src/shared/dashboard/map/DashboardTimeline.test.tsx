import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { DashboardTimeline } from './DashboardTimeline';

describe('地图年份时间轴', () => {
  it('空年份给出提示，单年保留文字且不伪造可拖动范围', async () => {
    const wrapper = mount(DashboardTimeline, { props: { years: [], ready: true } });
    expect(wrapper.text()).toContain('请选择年份');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.findAll('button:disabled')).toHaveLength(2);
    await wrapper.setProps({ years: [2026], activeYear: 2026 });
    expect(wrapper.text()).toContain('2026年');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.findAll('button:disabled')).toHaveLength(3);
    expect(wrapper.emitted('change')).toBeUndefined();
  });

  it('按已选年份索引拖动和切换，不把间隔年份当成连续年份', async () => {
    const wrapper = mount(DashboardTimeline, { props: { years: [2021, 2024, 2026], activeYear: 2026, ready: true } });
    await wrapper.get('input').setValue('1');
    expect(wrapper.emitted('change')).toEqual([[2024]]);
    await wrapper.setProps({ activeYear: 2024 });
    expect(wrapper.get('input').attributes('aria-valuetext')).toBe('2024年');
    await wrapper.get('[aria-label="上一个地图年份"]').trigger('click');
    await wrapper.get('[aria-label="下一个地图年份"]').trigger('click');
    expect(wrapper.emitted('change')).toEqual([[2024], [2021], [2026]]);
  });
});
