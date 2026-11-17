import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ChartCard } from './ChartCard';

describe('ChartCard', () => {
  it('默认标题是不可点击的文字，均值摘要、工具栏和图表按插槽排列', () => {
    const wrapper = mount(ChartCard, {
      props: { id: 'I02', title: '教育便利性指数', average: { year: 2025, text: '0.62' } },
      slots: {
        actions: () => <button type="button">操作</button>,
        toolbar: () => <div data-test="toolbar">分项</div>,
        default: () => <div data-test="plot">图表</div>
      }
    });
    const card = wrapper.get('article');
    expect(card.attributes('data-chart-id')).toBe('I02');
    expect(card.attributes('data-enter')).toBe('chart');
    expect(card.attributes('aria-current')).toBeUndefined();
    const title = wrapper.get('h3');
    expect(title.text()).toBe('教育便利性指数');
    expect(title.attributes('title')).toBe('教育便利性指数');
    expect(wrapper.get('h3 + button').text()).toBe('操作');
    expect(wrapper.get('[aria-label="最新所选年份的城市平均值"]').text()).toBe('2025均值 0.62');
    // 工具栏在标题行下面、均值摘要上面
    const order = [...card.element.children].map(child => child.textContent);
    expect(order).toEqual(['教育便利性指数操作', '分项', '2025均值 0.62', '图表']);
  });

  it('有空态文字时不渲染图表；调用方可以换掉标题、标记当前卡片', () => {
    const wrapper = mount(ChartCard, {
      props: { id: 'A-15', title: '标题', average: null, emptyText: '请选择城市后查看比较数据', current: true },
      attrs: { class: 'selected' },
      slots: {
        heading: () => <button type="button">可点击的标题</button>,
        default: () => <div data-test="plot">图表</div>
      }
    });
    const card = wrapper.get('article');
    expect(card.classes()).toContain('selected');
    expect(card.attributes('aria-current')).toBe('true');
    expect(wrapper.find('h3').exists()).toBe(false);
    expect(wrapper.get('button').text()).toBe('可点击的标题');
    expect(wrapper.text()).toContain('未选择比较年份');
    expect(wrapper.text()).toContain('请选择城市后查看比较数据');
    expect(wrapper.find('[data-test="plot"]').exists()).toBe(false);
  });
});
