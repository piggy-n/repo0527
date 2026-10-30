import { mount } from '@vue/test-utils';
import { ElSlider } from 'element-plus';
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { defaultParams, type ParamKey, type SimulationConditions } from '../model/params';
import { ParamPopover } from './ParamPopover';

const conditions: SimulationConditions = {
  years: [2026],
  cityCodes: ['320100', '320200', '320500'],
  indicatorIds: ['B-65', 'A-31', 'A-39']
};

const mountPopover = (paramKey: ParamKey) =>
  mount(ParamPopover, { props: { paramKey, conditions, params: defaultParams() } });

describe('ParamPopover', () => {
  it('参数没变时不能确定；改动后交给编排图预览、标出自定义口径，确定交出草稿', async () => {
    const wrapper = mountPopover('recognition');
    const ok = () => wrapper.findAll('button').find(button => button.text() === '确定');
    expect(ok()?.attributes('disabled')).toBeDefined();
    // 标题只在浮层上写一次，下面是作用于哪些指标
    expect(wrapper.findAll('h2, h3').map(title => title.text())).toEqual(['覆盖认定']);
    expect(wrapper.text()).toContain('作用于公园绿地覆盖率、社区卫生覆盖率');
    expect(wrapper.text()).not.toContain('自定义口径');

    const option = wrapper.findAll('.el-radio-button').find(button => button.text() === '相交即算');
    await required(option, '相交即算的选项').get('input').setValue(true);
    const draft = { ...defaultParams(), recognition: 'intersect' };
    expect(wrapper.emitted('preview')).toEqual([[draft]]);
    expect(wrapper.text()).toContain('自定义口径');
    expect(wrapper.text()).toContain('同消防救援、派出所的认定');
    expect(ok()?.attributes('disabled')).toBeUndefined();

    await ok()?.trigger('click');
    expect(wrapper.emitted('apply')).toEqual([[draft]]);
  });

  it('常住人口变化写出带符号的百分比；只作用于人均类指标', async () => {
    const wrapper = mountPopover('popChange');
    expect(wrapper.text()).toContain('作用于人均公园绿地');
    expect(wrapper.text()).not.toContain('覆盖率');
    expect(wrapper.text()).toContain('0%');

    wrapper.getComponent(ElSlider).vm.$emit('update:modelValue', -10);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('−10%');
    expect(wrapper.text()).toContain('自定义口径');
    expect(wrapper.emitted('preview')).toEqual([[{ ...defaultParams(), popChange: -10 }]]);
  });

  it('按 Esc 或关闭按钮取消', async () => {
    const wrapper = mountPopover('rule');
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.get('[aria-label="关闭"]').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(2);
  });
});
