import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ChartActions } from './ChartActions';

const base = {
  prefix: '教育便利性指数',
  downloadLabel: '下载教育便利性指数图表'
};

describe('ChartActions', () => {
  it('两种类型时是一个切换按钮，图标和文字是切换后的类型', async () => {
    const wrapper = mount(ChartActions, {
      props: { ...base, preference: { type: 'bar', showAverage: true, legend: {} }, expandLabel: '放大教育便利性指数图表' }
    });
    const toggle = wrapper.get('[aria-label="教育便利性指数切换为折线图"]');
    expect(toggle.attributes('title')).toBe('切换为折线图');
    expect(toggle.attributes('aria-pressed')).toBeUndefined();
    await toggle.trigger('click');
    await wrapper.get('[aria-label="教育便利性指数隐藏均值线"]').trigger('click');
    await wrapper.get('[aria-label="放大教育便利性指数图表"]').trigger('click');
    await wrapper.get('[aria-label="下载教育便利性指数图表"]').trigger('click');
    expect(wrapper.emitted('preference')).toEqual([[{ type: 'line' }], [{ showAverage: false }]]);
    expect(wrapper.emitted('expand')).toHaveLength(1);
    expect(wrapper.emitted('download')).toHaveLength(1);
    await wrapper.setProps({ preference: { type: 'line', showAverage: false, legend: {} } });
    expect(wrapper.find('[aria-label="教育便利性指数切换为柱状图"]').exists()).toBe(true);
    expect(wrapper.get('[aria-label="教育便利性指数显示均值线"]').attributes('aria-pressed')).toBe('false');
  });

  it('三种类型时是互斥的按钮组，选中的不再发出切换', async () => {
    const wrapper = mount(ChartActions, {
      props: { ...base, types: ['bar', 'line', 'radar'], preference: { type: 'radar', showAverage: false, legend: {} } }
    });
    const buttons = wrapper.findAll('[role="group"] button');
    expect(buttons.map(button => button.attributes('aria-label'))).toEqual([
      '教育便利性指数显示为柱状图',
      '教育便利性指数显示为折线图',
      '教育便利性指数显示为雷达图'
    ]);
    expect(buttons.map(button => button.attributes('aria-pressed'))).toEqual(['false', 'false', 'true']);
    await buttons[2].trigger('click');
    await buttons[0].trigger('click');
    expect(wrapper.emitted('preference')).toEqual([[{ type: 'bar' }]]);
    expect(wrapper.find('[aria-label^="放大"]').exists()).toBe(false);
  });

  it('均值线、下载的禁用和说明由调用方给出', () => {
    const wrapper = mount(ChartActions, {
      props: {
        ...base,
        preference: { type: 'bar', showAverage: false, legend: {} },
        averageDisabled: true,
        averageTitle: '堆叠模式只在提示表格显示逐年均值',
        downloadDisabled: true
      }
    });
    const average = wrapper.get('[aria-label="教育便利性指数显示均值线"]');
    expect(average.attributes('disabled')).toBeDefined();
    expect(average.attributes('title')).toBe('堆叠模式只在提示表格显示逐年均值');
    expect(wrapper.get('[aria-label="下载教育便利性指数图表"]').attributes('disabled')).toBeDefined();
  });

  it('均值线画不出来时不显示按下，文字和点击仍按偏好', async () => {
    const wrapper = mount(ChartActions, {
      props: { ...base, preference: { type: 'bar', showAverage: true, legend: {} }, averageDrawable: false }
    });
    const average = wrapper.get('[aria-label="教育便利性指数隐藏均值线"]');
    expect(average.attributes('aria-pressed')).toBe('false');
    expect(average.classes()).toHaveLength(1);
    await average.trigger('click');
    expect(wrapper.emitted('preference')).toEqual([[{ showAverage: false }]]);
    await wrapper.setProps({ averageDrawable: true });
    expect(average.attributes('aria-pressed')).toBe('true');
    expect(average.classes()).toHaveLength(2);
  });
});
