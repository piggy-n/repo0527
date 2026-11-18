import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { required } from '@/shared/testing/required';
import { PartTabs, revealScrollLeft, type TabExtent } from './PartTabs';

const PARTS = [
  { id: '与一级公路之间距离', name: '与一级公路之间距离' },
  { id: '与二级公路之间距离', name: '与二级公路之间距离' },
  { id: '与高速公路之间距离', name: '与高速公路之间距离' }
];

// 1920×1080 下交通干线便捷度的分项栏实测：综合、一级、二级、高速，可视宽 344，最大 scrollLeft 271
const TABS = [
  { start: 0, end: 60 },
  { start: 66, end: 245 },
  { start: 251, end: 430 },
  { start: 436, end: 615 }
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

  it('平滑滚动途中再切换时按滚动的终点判断，不停在选中项露不全的位置', async () => {
    const selected = ref<string | null>(PARTS[1]?.id ?? null);
    const wrapper = mount(() => <PartTabs parts={PARTS} selected={selected.value} label="分项" />);
    // jsdom 不排版，按 1920×1080 的实测写上分项的位置、可视宽和滚动位置
    const view = wrapper.get('[role="tablist"]').element as HTMLElement;
    wrapper.findAll('[role="tab"]').forEach((tab, position) => {
      const { start, end } = required(TABS[position], '分项的位置');
      Object.defineProperties(tab.element, { offsetLeft: { value: start }, offsetWidth: { value: end - start } });
    });
    const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
    Object.defineProperties(view, {
      clientWidth: { value: 344 },
      scrollLeft: { value: 86, writable: true },
      scrollTo: { value: scrollTo }
    });
    selected.value = PARTS[2]?.id ?? null;
    await nextTick();
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 271, behavior: 'smooth' });
    // 滚到 248 时切回二级：二级此刻完整、左边缘在空隙里，但滚动还会接着走到 271，把它切掉 20 像素
    view.scrollLeft = 248;
    selected.value = PARTS[1]?.id ?? null;
    await nextTick();
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 251, behavior: 'smooth' });
  });
});

// 从「综合」开始，右箭头逐个切到最后一项，再左箭头逐个切回「综合」，每一步停下的 scrollLeft
function walk(extents: readonly TabExtent[], viewWidth: number): number[] {
  const steps = [
    ...extents.slice(1).map((_, position) => [position + 1, 1] as const),
    ...extents.slice(1).map((_, position) => [extents.length - 2 - position, -1] as const)
  ];
  const stops: number[] = [];
  let left = 0;
  for (const [index, direction] of steps) {
    left = revealScrollLeft(extents, index, left, viewWidth, direction);
    stops.push(left);
  }
  return stops;
}

// 两侧边缘切出的分项露出的宽度，没切到时为 0
function edgeCuts(extents: readonly TabExtent[], left: number, viewWidth: number): [number, number] {
  const right = left + viewWidth;
  const atLeft = extents.find(tab => tab.start < left && tab.end > left);
  const atRight = extents.find(tab => tab.start < right && tab.end > right);
  return [atLeft ? atLeft.end - left : 0, atRight ? right - atRight.start : 0];
}

// 逐个切换的每一步里，边缘切出的露出不到 24 像素的窄条
function slivers(extents: readonly TabExtent[], viewWidth: number): number[] {
  return walk(extents, viewWidth)
    .flatMap(left => edgeCuts(extents, left, viewWidth))
    .filter(cut => cut > 0 && cut < 24);
}

describe('revealScrollLeft', () => {
  // 交通枢纽便捷度的五项按 1920 实测的每字宽度推算：一个字 17 像素，内边距和边框共 26 像素
  const HUB_TABS = [
    { start: 0, end: 60 },
    { start: 66, end: 245 },
    { start: 251, end: 396 },
    { start: 402, end: 547 },
    { start: 553, end: 715 }
  ];
  // 界面缩放 0.9（1920 宽的窗口不全屏时）下的交通干线便捷度：分项按 1366×768 的实测，可视宽 346
  const SCALED_TABS = [
    { start: 0, end: 54 },
    { start: 60, end: 221 },
    { start: 227, end: 388 },
    { start: 394, end: 555 }
  ];

  it('逐个切过去再切回来：选中项完整，两侧边缘不切出露出不到 24 像素的窄条', () => {
    expect(walk(TABS, 344)).toEqual([0, 86, 271, 251, 0, 0]);
    // 往右切到第一个分项时不动：滚到让第二个分项完整会在左边留 8 像素的「综合」
    expect(walk(HUB_TABS, 344)).toEqual([0, 203, 371, 371, 251, 251, 0, 0]);
    expect(slivers(TABS, 344)).toEqual([]);
    expect(slivers(HUB_TABS, 344)).toEqual([]);
  });

  it('贴边对齐都会留窄条时让选中项居中，两侧各露出大半个分项；只有一个位置放得下时停在那里', () => {
    // 往右切到二级：贴右边会在左边留 12 像素的一级，贴左边会在右边留 12 像素的高速
    expect(walk(SCALED_TABS, 346)).toEqual([0, 135, 209, 135, 0, 0]);
    expect(edgeCuts(SCALED_TABS, 135, 346)).toEqual([86, 87]);
    // 最后一项只能滚到头，左边的 12 像素躲不开
    expect(slivers(SCALED_TABS, 346)).toEqual([12]);
  });

  it('往左切回第一个分项时连同「综合」一起滚到头，不留半个「综合」', () => {
    expect(revealScrollLeft(TABS, 1, 271, 344, -1)).toBe(0);
    // 一级已经完整、左边缘也没切到分项，但「综合」整个藏着，右边还留着 12 像素的高速
    expect(revealScrollLeft(SCALED_TABS, 1, 60, 346, -1)).toBe(0);
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
