import { mount } from '@vue/test-utils';
import { ElOption } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { DASHBOARD_CITIES } from '../cities';
import { CityFilter } from './CityFilter';
import { FilterPanel } from './FilterPanel';
import { FilterSection } from './FilterSection';
import { IconOptionList } from './IconOptionList';
import { OptionList } from './OptionList';
import { YearFilter } from './YearFilter';
import styles from './filters.module.scss';

afterEach(() => {
  // 年份下拉渲染在 body 下，不归组件管
  document.body.innerHTML = '';
});

describe('驾驶舱筛选单元', () => {
  it('面板和区块带入场用的标记，入场完成前不可操作', () => {
    const wrapper = mount(FilterPanel, {
      props: { active: false },
      slots: { default: () => <FilterSection title="一级指标">内容</FilterSection> }
    });
    const panel = wrapper.get('aside');
    expect(panel.attributes('aria-label')).toBe('大屏筛选条件');
    expect(panel.attributes('data-enter')).toBe('left');
    expect(panel.attributes('inert')).toBeDefined();
    const section = wrapper.get('section');
    expect(section.attributes('data-filter-group')).toBeDefined();
    expect(section.get('h2').text()).toBe('一级指标');
  });

  it('只有传了 compact 的面板在矮屏上收紧，不传时类名和原来一样', async () => {
    const wrapper = mount(FilterPanel);
    const classes = wrapper.get('aside').classes();
    expect(classes).toHaveLength(2);
    await wrapper.setProps({ compact: true });
    expect(wrapper.get('aside').classes()).toEqual([...classes, styles.compact]);
  });

  it('行政区划逐个切换，标题右侧在全选和清空之间切换', async () => {
    const wrapper = mount(CityFilter, { props: { cities: DASHBOARD_CITIES, selected: ['320100'] } });
    const nanjing = wrapper.get('button[aria-pressed="true"]');
    expect(nanjing.text()).toBe('南京市');
    await wrapper.findAll('button[aria-pressed]')[1].trigger('click');
    const toggleAll = wrapper.get('h2 + button');
    expect(toggleAll.text()).toBe('全选');
    await toggleAll.trigger('click');
    await wrapper.setProps({ selected: DASHBOARD_CITIES.map(city => city.code) });
    expect(toggleAll.text()).toBe('清空');
    await toggleAll.trigger('click');
    expect(wrapper.emitted('toggle')).toEqual([['320200']]);
    expect(wrapper.emitted('set')).toEqual([[DASHBOARD_CITIES.map(city => city.code)], [[]]]);
  });

  it('年份是否可以清空由调用方决定', () => {
    const wrapper = mount(YearFilter, { props: { options: [2025], selected: [2025], clearable: false } });
    expect(wrapper.get('h2').text()).toBe('年份选择');
    expect(wrapper.findComponent({ name: 'ElSelect' }).props('clearable')).toBe(false);
  });

  it('不能清空时最后一个年份的标签没有关闭按钮，退格也删不掉', async () => {
    const wrapper = mount(YearFilter, { props: { options: [2024, 2025], selected: [2025], clearable: false } });
    await nextTick();
    const disabled = () => wrapper.findAllComponents(ElOption).map(option => option.props('disabled'));
    expect(disabled()).toEqual([false, true]);
    expect(wrapper.find('.el-tag__close').exists()).toBe(false);
    await wrapper.get('input').trigger('keydown', { key: 'Backspace', code: 'Backspace' });
    expect(wrapper.emitted('change')).toBeUndefined();
    // 选了两个时都能去掉；可以清空时最后一个也能去掉
    await wrapper.setProps({ selected: [2024, 2025] });
    expect(disabled()).toEqual([false, false]);
    expect(wrapper.findAll('.el-tag__close')).toHaveLength(2);
    await wrapper.setProps({ selected: [2025], clearable: true });
    expect(disabled()).toEqual([false, false]);
    expect(wrapper.findAll('.el-tag__close')).toHaveLength(1);
    await wrapper.get('input').trigger('keydown', { key: 'Backspace', code: 'Backspace' });
    expect(wrapper.emitted('change')).toEqual([[[]]]);
  });

  it('带图标的列表只在选中项显示箭头', async () => {
    const options = [
      { id: 'livability', name: '生活宜居便利性', icon: 'dashboard-happiness' },
      { id: 'safety', name: '城市安全韧性', icon: 'dashboard-resilience' }
    ] as const;
    const wrapper = mount(IconOptionList, { props: { options, selected: 'safety' } });
    const buttons = wrapper.findAll('button');
    expect(buttons.map(button => button.attributes('aria-pressed'))).toEqual(['false', 'true']);
    expect(buttons[0].findAll('svg')).toHaveLength(1);
    expect(buttons[1].findAll('svg')).toHaveLength(2);
    await buttons[0].trigger('click');
    expect(wrapper.emitted('select')).toEqual([['livability']]);
  });

  it('文字列表换了一组选项后回到顶部', async () => {
    const wrapper = mount(OptionList, {
      props: { options: [{ id: 'I02', label: '教育便利性' }], selected: 'I02', label: '二级指标列表', resetKey: 'a' }
    });
    const list = wrapper.get('[role="group"]');
    expect(list.attributes('aria-label')).toBe('二级指标列表');
    const scrollTo = vi.fn<(...args: unknown[]) => void>();
    list.element.scrollTo = scrollTo;
    await wrapper.setProps({ selected: 'I03' });
    await nextTick();
    expect(scrollTo).not.toHaveBeenCalled();
    await wrapper.setProps({ resetKey: 'b', options: [{ id: 'I10', label: '医疗便利性' }], selected: 'I10' });
    await nextTick();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('select')).toEqual([['I10']]);
  });
});
