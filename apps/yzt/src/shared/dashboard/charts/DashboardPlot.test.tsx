import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_CITIES } from '../cities';
import { DashboardPlot } from './DashboardPlot';

// jsdom 里没有尺寸，不创建图表引擎，只看键盘和读屏文字
describe('DashboardPlot 的悬停方式', () => {
  it('axis：左右键逐个城市发出悬停，Esc 关闭', async () => {
    const wrapper = mount(DashboardPlot, {
      props: { option: {}, cities: DASHBOARD_CITIES, description: '教育便利性指数多年度比较' }
    });
    expect(wrapper.attributes('aria-label')).toBe('教育便利性指数多年度比较，左右键查看城市数值，Esc 关闭提示');
    // 不在视野里时释放引擎，顺带发出一次空的悬停
    const before = wrapper.emitted('hover')?.length ?? 0;
    await wrapper.trigger('keydown', { key: 'ArrowRight' });
    await wrapper.trigger('keydown', { key: 'ArrowRight' });
    await wrapper.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('hover')?.slice(before)).toEqual([['320100'], ['320200'], [null]]);
  });

  it('none：不发悬停，左右键不处理，读屏文字不提按键', async () => {
    const wrapper = mount(DashboardPlot, {
      props: { option: {}, cities: DASHBOARD_CITIES, description: '教育便利性指数雷达图', hoverMode: 'none' }
    });
    expect(wrapper.attributes('aria-label')).toBe('教育便利性指数雷达图');
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    (wrapper.element as HTMLElement).dispatchEvent(right);
    await wrapper.trigger('keydown', { key: 'Escape' });
    await wrapper.trigger('blur');
    expect(right.defaultPrevented).toBe(false);
    expect(wrapper.emitted('hover')).toBeUndefined();
  });
});
