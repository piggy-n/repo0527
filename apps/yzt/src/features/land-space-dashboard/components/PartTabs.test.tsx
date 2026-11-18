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

  it('按左右按钮到头时按钮停用，焦点交给选中的分项，不落回页面', async () => {
    const selected = ref<string | null>(PARTS[0]?.id ?? null);
    const select = (id: string | null) => {
      selected.value = id;
    };
    const wrapper = mount(() => <PartTabs parts={PARTS} selected={selected.value} label="分项" onSelect={select} />, {
      attachTo: document.body
    });
    const next = wrapper.get<HTMLButtonElement>('[aria-label="下一个分项"]');
    next.element.focus();
    // 没到头时焦点留在按钮上，可以接着按
    await next.trigger('click');
    await flushPromises();
    expect([selected.value, document.activeElement === next.element]).toEqual([PARTS[1]?.id, true]);
    await next.trigger('click');
    await flushPromises();
    expect(next.element.disabled).toBe(true);
    expect([selected.value, focused()]).toEqual([PARTS[2]?.id, '与高速公路之间距离']);
    selected.value = PARTS[0]?.id ?? null;
    await flushPromises();
    const previous = wrapper.get<HTMLButtonElement>('[aria-label="上一个分项"]');
    previous.element.focus();
    await previous.trigger('click');
    await flushPromises();
    expect(previous.element.disabled).toBe(true);
    expect([selected.value, focused()]).toEqual([null, '综合']);
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
  // 1920×1080 下交通干线便捷度的分项栏实测：综合、一级、二级、高速，可视宽 344，最大 scrollLeft 271
  const TABS = [
    { start: 0, end: 60 },
    { start: 66, end: 245 },
    { start: 251, end: 430 },
    { start: 436, end: 615 }
  ];

  it('往左切回第一个分项时连同「综合」一起滚到头，不留半个「综合」', () => {
    expect(revealScrollLeft(TABS, 1, 271, 344, -1)).toBe(0);
  });

  it('往左切到露不全的分项时它贴左边，左边缘不切到前一个', () => {
    expect(revealScrollLeft(TABS, 2, 271, 344, -1)).toBe(251);
  });

  it('选中项已经完整、但移动方向那一侧切着半个分项时也对齐', () => {
    // 视野 [50, 300] 切着第一个；往左切到完整露出的第二个，连同第一个一起放下
    const evenTabs = [
      { start: 0, end: 100 },
      { start: 106, end: 206 },
      { start: 212, end: 312 }
    ];
    expect(revealScrollLeft(evenTabs, 1, 50, 250, -1)).toBe(0);
  });

  it('往右切时选中项贴右边，放得下后面的分项时滚到最右', () => {
    expect(revealScrollLeft(TABS, 2, 0, 344, 1)).toBe(86);
    expect(revealScrollLeft(TABS, 3, 86, 344, 1)).toBe(271);
  });

  it('选中项完整、移动方向那一侧没有半个分项时不动', () => {
    expect(revealScrollLeft(TABS, 1, 0, 700, 1)).toBe(0);
    expect(revealScrollLeft(TABS, 2, 251, 344, -1)).toBe(251);
  });

  it('选中项本身放不下时对齐它靠移动方向的那一端', () => {
    expect(revealScrollLeft(TABS, 2, 0, 150, -1)).toBe(251);
    expect(revealScrollLeft(TABS, 2, 0, 150, 1)).toBe(280);
  });
});
