import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { required } from '@/shared/testing/required';
import { useLandSpaceDashboard } from '../composables/useLandSpaceDashboard';
import { LandSpaceCharts, type LandSpaceChartsHandle } from './LandSpaceCharts';

afterEach(() => {
  // 下拉菜单、详情弹窗渲染在 body 下，不归组件管
  document.body.innerHTML = '';
});

function mountCharts() {
  const model = useLandSpaceDashboard();
  const wrapper = mount(LandSpaceCharts, { props: { model }, attachTo: document.body });
  return { model, wrapper };
}

function card(wrapper: VueWrapper, id: string) {
  return wrapper.get(`[data-chart-id="${id}"]`);
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  return required(
    [...root.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label),
    `"${label}"按钮`
  );
}

describe('LandSpaceCharts', () => {
  it('固定一级、二级、三级三张卡，标题不可点击，没有选中框', () => {
    const { wrapper } = mountCharts();
    const cards = wrapper.findAll('[data-chart-id]');
    expect(cards.map(item => item.attributes('data-chart-id'))).toEqual(['domain', 'sub', 'indicator']);
    expect(cards.every(item => item.attributes('data-enter') === 'chart')).toBe(true);
    expect(cards.some(item => item.classes().some(name => name.includes('selected')))).toBe(false);
    expect(cards.some(item => item.attributes('aria-current') !== undefined)).toBe(false);
    expect(card(wrapper, 'domain').get('h3').text()).toBe('生活宜居便利性');
    expect(card(wrapper, 'sub').get('h3').text()).toBe('教育便利性');
    expect(card(wrapper, 'indicator').find('h3').exists()).toBe(false);
    expect(card(wrapper, 'indicator').get('[aria-haspopup="menu"]').text()).toBe('幼儿园步行5分钟覆盖率（%）');
    // 13 个市的算术平均 0.547，指数保留两位
    expect(card(wrapper, 'domain').get('[aria-label="最新所选年份的城市平均值"]').text()).toBe('2025均值 0.55');
  });

  it('默认一级柱、二级雷达、三级柱；切换类型写回各自卡位的偏好', async () => {
    const { model, wrapper } = mountCharts();
    const root = document.body;
    expect(button(root, '生活宜居便利性切换为折线图')).toBeTruthy();
    expect(button(root, '幼儿园步行5分钟覆盖率切换为折线图')).toBeTruthy();
    const pressed = card(wrapper, 'sub').findAll('[aria-pressed="true"]').map(item => item.attributes('aria-label'));
    expect(pressed).toEqual(['教育便利性隐藏均值线', '教育便利性显示为雷达图']);
    // 雷达不发悬停，读屏文字不提左右键
    expect(card(wrapper, 'sub').get('[role="img"]').attributes('aria-label')).toBe('教育便利性各市比较');
    button(root, '生活宜居便利性切换为折线图').click();
    button(root, '教育便利性显示为柱状图').click();
    await nextTick();
    expect([model.preferences.value.domain.type, model.preferences.value.sub.type]).toEqual(['line', 'bar']);
    expect(button(root, '生活宜居便利性切换为柱状图')).toBeTruthy();
    expect(card(wrapper, 'sub').get('[role="img"]').attributes('aria-label')).toContain('左右键查看城市数值');
  });

  it('三级的标题是下拉框：列出当前二级下的三级、标出当前项，选中后切换三级', async () => {
    const { model, wrapper } = mountCharts();
    await card(wrapper, 'indicator').get('[aria-haspopup="menu"]').trigger('click');
    await vi.waitFor(() => expect(document.querySelector('.el-dropdown-menu')).not.toBeNull());
    const items = [...document.querySelectorAll<HTMLElement>('.el-dropdown-menu__item')];
    expect(items.map(item => item.textContent.trim())).toEqual([
      '幼儿园步行5分钟覆盖率（%）',
      '社区小学步行10分钟覆盖率（%）',
      '社区中学步行15分钟覆盖率（%）'
    ]);
    expect(items.map(item => item.getAttribute('aria-current'))).toEqual(['true', null, null]);
    items[2]?.click();
    await flushPromises();
    expect(model.state.value.indicatorId).toBe('M03');
    expect(card(wrapper, 'indicator').get('[aria-haspopup="menu"]').attributes('title')).toBe('社区中学步行15分钟覆盖率（%）');
  });

  it('分项栏只在有分项的三级出现，默认「综合」，选分项后卡片标题和比较跟着分项', async () => {
    const { model, wrapper } = mountCharts();
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
    model.selectDomain('transport');
    model.selectSubIndex('I25');
    await nextTick();
    const tabs = () => card(wrapper, 'indicator').findAll('[role="tab"]');
    expect(tabs().map(tab => [tab.text(), tab.attributes('aria-selected')])).toEqual([
      ['综合', 'true'],
      ['与一级公路之间距离', 'false'],
      ['与二级公路之间距离', 'false'],
      ['与高速公路之间距离', 'false']
    ]);
    await tabs()[2]?.trigger('click');
    expect(model.state.value.partId).toBe('与二级公路之间距离');
    expect(button(document.body, '放大交通干线便捷度 · 与二级公路之间距离图表')).toBeTruthy();
    model.selectIndicator('M63');
    await nextTick();
    expect(tabs()).toHaveLength(5);
    expect(tabs()[0]?.attributes('aria-selected')).toBe('true');
    model.selectSubIndex('I26');
    await nextTick();
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
  });

  it('没有指数值的二级、雷达的城市不够、没选城市时显示空态，下载停用', async () => {
    const { model, wrapper } = mountCharts();
    model.selectSubIndex('I05');
    await nextTick();
    expect(card(wrapper, 'sub').text()).toContain('原报告未列指数值');
    expect(button(document.body, '下载体育活动便利性图表').disabled).toBe(true);
    expect(card(wrapper, 'indicator').find('[role="img"]').exists()).toBe(true);
    model.selectSubIndex('I07');
    model.setCities(['320100', '320200']);
    await nextTick();
    expect(card(wrapper, 'sub').text()).toContain('雷达图至少需要 3 个城市');
    expect(card(wrapper, 'domain').find('[role="img"]').exists()).toBe(true);
    model.setCities([]);
    await nextTick();
    expect(card(wrapper, 'domain').text()).toContain('请选择城市后查看比较数据');
    expect(button(document.body, '下载生活宜居便利性图表').disabled).toBe(true);
  });

  it('地图点城市打开二级卡的详情并强调这个城市', async () => {
    const { wrapper } = mountCharts();
    (wrapper.vm as unknown as LandSpaceChartsHandle).openDetail('sub', '320100');
    await flushPromises();
    const dialog = required(document.querySelector('.el-dialog'), '详情弹窗');
    expect(dialog.querySelector('.el-dialog__body h2')?.textContent).toBe('教育便利性');
    expect(dialog.textContent).toContain('南京市 · 当前查看城市');
    expect(dialog.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('教育便利性详情');
    expect(button(dialog, '详情图显示为雷达图').getAttribute('aria-pressed')).toBe('true');
  });
});
