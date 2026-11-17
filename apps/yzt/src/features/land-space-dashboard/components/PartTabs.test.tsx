import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { PartTabs, revealScrollLeft } from './PartTabs';

const PARTS = [
  { id: '与一级公路之间距离', name: '与一级公路之间距离' },
  { id: '与二级公路之间距离', name: '与二级公路之间距离' },
  { id: '与高速公路之间距离', name: '与高速公路之间距离' }
];

function tabs(wrapper: VueWrapper) {
  return wrapper.findAll('[role="tab"]').map(tab => [tab.text(), tab.attributes('aria-selected')]);
}

function focused() {
  return document.activeElement?.textContent;
}

describe('PartTabs', () => {
  it('第一项是「综合」并默认选中，只有选中项能用 Tab 键进入', () => {
    const wrapper = mount(PartTabs, { props: { parts: PARTS, label: '交通干线便捷度的分项' } });
    expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('交通干线便捷度的分项');
    expect(tabs(wrapper)).toEqual([
      ['综合', 'true'],
      ['与一级公路之间距离', 'false'],
      ['与二级公路之间距离', 'false'],
      ['与高速公路之间距离', 'false']
    ]);
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
  });

  it('少于两个分项时不显示', () => {
    const wrapper = mount(PartTabs, { props: { parts: PARTS.slice(0, 1), label: '分项' } });
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
  });

  it('左右按钮切到上一个、下一个分项，到头时停用', async () => {
    const wrapper = mount(PartTabs, { props: { parts: PARTS, label: '分项' } });
    const previous = wrapper.get('[aria-label="上一个分项"]');
    const next = wrapper.get('[aria-label="下一个分项"]');
    expect(previous.attributes('disabled')).toBeDefined();
    await next.trigger('click');
    expect(wrapper.emitted('select')).toEqual([[PARTS[0]?.id]]);
    await wrapper.setProps({ selected: PARTS[2]?.id });
    expect(next.attributes('disabled')).toBeDefined();
    expect(previous.attributes('disabled')).toBeUndefined();
    await previous.trigger('click');
    expect(wrapper.emitted('select')?.at(-1)).toEqual([PARTS[1]?.id]);
  });

  it('方向键、Home、End 切换，焦点跟着选中项', async () => {
    // 和真实用法一样，选中项由上层按 select 更新
    const selected = ref<string | null>(null);
    const select = (id: string | null) => {
      selected.value = id;
    };
    const wrapper = mount(() => <PartTabs parts={PARTS} selected={selected.value} label="分项" onSelect={select} />, {
      attachTo: document.body
    });
    const list = wrapper.get('[role="tablist"]');
    await list.trigger('keydown', { key: 'ArrowLeft' });
    expect(selected.value).toBeNull();
    await list.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect([selected.value, focused()]).toEqual([PARTS[0]?.id, '与一级公路之间距离']);
    await list.trigger('keydown', { key: 'End' });
    await flushPromises();
    expect([selected.value, focused()]).toEqual([PARTS[2]?.id, '与高速公路之间距离']);
    await list.trigger('keydown', { key: 'ArrowRight' });
    await list.trigger('keydown', { key: 'Home' });
    await flushPromises();
    expect([selected.value, focused()]).toEqual([null, '综合']);
  });
});

describe('revealScrollLeft', () => {
  it('选中项在视野外时滚到它完整露出、离边缘留 12 像素，已经在视野里时不动', () => {
    // 视野 [100, 300]
    expect(revealScrollLeft(100, 200, 150, 60)).toBe(100);
    expect(revealScrollLeft(100, 200, 40, 60)).toBe(28);
    expect(revealScrollLeft(100, 200, 260, 80)).toBe(152);
    expect(revealScrollLeft(100, 200, 5, 60)).toBe(0);
  });
});
