import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createCalculator } from '../model/calculator';
import { defaultParams, type ParamKey, type SimulationConditions } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { ParamFields } from './ParamFields';
import { ParamPopover } from './ParamPopover';

const conditions: SimulationConditions = {
  years: [2026],
  cityCodes: ['320100', '320200', '320500'],
  indicatorIds: ['B-65', 'A-31', 'A-39']
};

async function mountPopover(paramKey: ParamKey = 'newFacilities', years = conditions.years) {
  const calculator = createCalculator(await loadTestAtlas());
  return mount(ParamPopover, {
    props: { paramKey, model: { status: 'ready', calculator }, conditions: { ...conditions, years }, params: defaultParams() }
  });
}

describe('ParamPopover', () => {
  it('参数没变时不能确定；改动后预估跟着变，上升标红，确定交出草稿', async () => {
    const wrapper = await mountPopover();
    const ok = () => wrapper.findAll('button').find(button => button.text() === '确定');
    expect(ok()?.attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('h3').map(title => title.text())).toEqual(['指标预估结果', '规划新增设施']);
    expect(wrapper.text()).toContain('全省 · 2026 年');
    expect(wrapper.text()).not.toMatch(/参数未变化|预估按同一模型即时计算/);

    const draft = { ...defaultParams(), newFacilities: 20, scenarioIds: ['B-65'] };
    wrapper.getComponent(ParamFields).vm.$emit('update:modelValue', draft);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain('保存到计算参数');
    // 作用范围外的社区卫生覆盖率不变；作用范围里的上升，用红色
    const rows = wrapper.findAll('[class*="_row_"]');
    expect(rows.map(row => row.text().includes('不变'))).toEqual([false, true, true]);
    const rise = rows[0]?.find('[class*="_up_"]');
    expect(rise?.exists()).toBe(true);
    expect(rise?.text()).toMatch(/^\+/);

    await ok()?.trigger('click');
    expect(wrapper.emitted('apply')).toEqual([[draft]]);
  });

  it('还没选年度时不预估，提示先选年度', async () => {
    const wrapper = await mountPopover('walkSpeed', []);

    expect(wrapper.text()).toContain('选择监测年份后显示预估');
    expect(wrapper.text()).not.toMatch(/NaN|Infinity/);
    expect(wrapper.findAll('[class*="_row_"]')).toHaveLength(0);
  });

  it('选了几个年度时写明预估的是最新年度；目标值的说明跟在标题后面', async () => {
    const wrapper = await mountPopover('targets', [2025, 2026]);

    expect(wrapper.text()).toContain('全省 · 最新年度 2026 年');
    const titles = wrapper.findAll('h3').map(title => title.element.parentElement?.textContent);
    expect(titles).toEqual(['指标预估结果全省 · 最新年度 2026 年', '目标值影响达标判断']);
  });

  it('作用范围的标签切换：去掉一项后记为其余几项，全部选上记为全部', async () => {
    const wrapper = await mountPopover();
    const tags = () => wrapper.findAll('.el-check-tag');
    expect(tags().map(tag => tag.classes().includes('is-checked'))).toEqual([true, true, true]);

    await tags()[1]?.trigger('click');
    expect(wrapper.getComponent(ParamFields).emitted('update:modelValue')?.at(-1)).toEqual([
      { ...defaultParams(), scenarioIds: ['B-65', 'A-39'] }
    ]);
    await tags()[1]?.trigger('click');
    expect(wrapper.getComponent(ParamFields).emitted('update:modelValue')?.at(-1)).toEqual([defaultParams()]);
  });

  it('按 Esc 或关闭按钮取消', async () => {
    const wrapper = await mountPopover();
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(2);
  });
});
