import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createCalculator } from '../model/calculator';
import { defaultParams, type SimulationConditions } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { ParamFields } from './ParamFields';
import { ParamPopover } from './ParamPopover';

const conditions: SimulationConditions = {
  years: [2026],
  cityCodes: ['320100', '320200', '320500'],
  indicatorIds: ['B-65', 'A-31', 'A-39']
};

async function mountPopover() {
  const calculator = createCalculator(await loadTestAtlas());
  return mount(ParamPopover, {
    props: { paramKey: 'newFacilities', model: { status: 'ready', calculator }, conditions, params: defaultParams() }
  });
}

describe('ParamPopover', () => {
  it('参数没变时不能确定；改动后预估跟着变，确定交出草稿', async () => {
    const wrapper = await mountPopover();
    const ok = () => wrapper.findAll('button').find(button => button.text() === '确定');
    expect(ok()?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('参数未变化');
    expect(wrapper.text()).toContain('2026 年全省预估');

    const draft = { ...defaultParams(), newFacilities: 20, scenarioIds: ['B-65'] };
    wrapper.getComponent(ParamFields).vm.$emit('update:modelValue', draft);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('保存到计算参数，开始推演时使用');
    // 作用范围外的社区卫生覆盖率不变
    expect(wrapper.findAll('[class*="_row_"]').map(row => row.text().includes('不变'))).toEqual([false, true, true]);

    await ok()?.trigger('click');
    expect(wrapper.emitted('apply')).toEqual([[draft]]);
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
