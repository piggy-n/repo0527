import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, shallowRef } from 'vue';
import { ALL_REQUEST_KINDS, type RequestDisplay, type RequestItem, type RequestKinds } from './request-status';
import { RequestStatusChip } from './RequestStatusChip';
import type { RequestStatus } from './useRequestStatus';

const item = (key: string, extra: Partial<RequestItem> = {}): RequestItem => ({
  key,
  kind: 'tiles',
  name: `${key} 的名称`,
  icon: 'geometry-polygon',
  requested: 10,
  loaded: 4,
  failed: 0,
  previousFailed: 0,
  detail: null,
  startedAt: 0,
  finishedAt: null,
  ...extra
});

// 条目这一次显示着、还有在加载的
const SHOWING: RequestDisplay = { settledAt: null };

// 状态由用例直接改；默认条目显示着
function mountChip(
  initial: readonly RequestItem[],
  now = 1000,
  shown: RequestKinds = ALL_REQUEST_KINDS,
  shownDisplay: RequestDisplay | null = SHOWING
) {
  const items = shallowRef(initial);
  const clock = shallowRef(now);
  const kinds = shallowRef(shown);
  const display = shallowRef(shownDisplay);
  const status: RequestStatus = {
    items: computed(() => items.value),
    now: clock,
    display,
    loadingKeys: computed(() => new Set<string>()),
    failedKeys: computed(() => new Set<string>()),
    kinds: computed(() => kinds.value)
  };
  const wrapper = mount(RequestStatusChip, {
    props: { status, selectable: (key: string) => key !== 'basemap' },
    attachTo: document.body
  });
  return { wrapper, items, clock, display };
}

// 量到的位置由用例给出：jsdom 没有布局
function placed(left: number, top: number, right: number, bottom: number): HTMLElement {
  const element = document.body.appendChild(document.createElement('div'));
  element.getBoundingClientRect = () => new DOMRect(left, top, right - left, bottom - top);
  return element;
}

// jsdom 没有 ResizeObserver：用例换成这个，记下每个观察者看着的元素，由用例通知尺寸变了
class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = [];
  readonly targets = new Set<Element>();
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  /** 看着 element 的观察者都收到一次通知 */
  static resized(element: Element): void {
    for (const observer of FakeResizeObserver.instances.filter(watcher => watcher.targets.has(element))) {
      observer.#callback([], observer);
    }
  }

  static watching(element: Element): boolean {
    return FakeResizeObserver.instances.some(watcher => watcher.targets.has(element));
  }
}

afterEach(() => {
  document.body.innerHTML = '';
  FakeResizeObserver.instances.length = 0;
  vi.unstubAllGlobals();
});

describe('RequestStatusChip', () => {
  it('空闲时什么也不显示；显示着时是加载中的项数和比例，有失败时带红点；结束后显示失败的项数', async () => {
    const { wrapper, items, clock, display } = mountChip([], 1000, ALL_REQUEST_KINDS, null);
    expect(wrapper.find('[data-request-status]').exists()).toBe(false);

    // b 上一轮有失败，这一轮还在加载
    items.value = [item('a'), item('b', { previousFailed: 1, loaded: 6 })];
    display.value = SHOWING;
    await nextTick();
    const chip = wrapper.get('[data-request-chip]');
    expect(chip.attributes('data-request-chip')).toBe('loading');
    expect(chip.text()).toBe('正在加载 2 项 · 50%');
    expect(chip.find('[aria-label="1 项有失败"]').exists()).toBe(true);

    items.value = [item('b', { failed: 1, loaded: 9, finishedAt: 900 })];
    clock.value = 2000;
    await nextTick();
    expect(wrapper.get('[data-request-chip]').text()).toBe('1 项加载失败');
  });

  it('点开是明细：分组列出，点一行交给页面选中（底图不能选），模型失败的可以重试；Esc、再点条目关闭', async () => {
    const { wrapper } = mountChip([
      item('resource:a'),
      item('basemap', { name: '底图' }),
      item('model:m', { kind: 'model', requested: 0, loaded: 0, failed: 1, finishedAt: 500, icon: 'model-3d' }),
      item('resource:b', { loaded: 10, finishedAt: 600 })
    ]);
    await wrapper.get('[data-request-chip]').trigger('click');
    const popover = wrapper.get('[data-request-popover]');
    expect(popover.findAll('li').map(row => row.text())).toStrictEqual([
      '加载中',
      'resource:a 的名称4/10 张',
      '底图4/10 张',
      '有失败',
      'model:m 的名称加载失败重试',
      '已完成',
      'resource:b 的名称10 张'
    ]);

    // 能选的行悬停时说明点了做什么（面板下段叫"图层"，用户 2026-11-16）
    expect(popover.get('[data-request-row="resource:a"]').attributes('title')).toBe('在图层列表中选中');
    expect(popover.get('[data-request-row="basemap"]').attributes('title')).toBeUndefined();
    await popover.get('[data-request-row="resource:a"]').trigger('click');
    await popover.get('[data-request-row="basemap"]').trigger('click');
    await popover.get('button[aria-label="重新加载：model:m 的名称"]').trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['resource:a']]);
    expect(wrapper.emitted('retry')).toStrictEqual([['model:m']]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(wrapper.find('[data-request-popover]').exists()).toBe(false);
    await wrapper.get('[data-request-chip]').trigger('click');
    await wrapper.get('[data-request-chip]').trigger('click');
    expect(wrapper.find('[data-request-popover]').exists()).toBe(false);
  });

  it('明细里能选的行，名称是按钮（键盘能到达），行本身仍是列表项；失败模型行的"重试"不套在名称按钮里；底图那行没有按钮（2026-11-15 审查发现）', async () => {
    const { wrapper } = mountChip([
      item('resource:a'),
      item('basemap', { name: '底图' }),
      item('model:m', { kind: 'model', requested: 0, loaded: 0, failed: 1, finishedAt: 500, icon: 'model-3d' })
    ]);
    await wrapper.get('[data-request-chip]').trigger('click');
    const row = wrapper.get('[data-request-row="resource:a"]');
    expect(row.element.tagName).toBe('LI');
    expect(row.attributes('role')).toBeUndefined();
    expect(row.find('button[data-request-select]').exists()).toBe(true);
    const name = row.get('button[data-request-select]');
    expect(name.text()).toBe('resource:a 的名称');
    expect(wrapper.find('[data-request-row="basemap"] button').exists()).toBe(false);
    const model = wrapper.get('[data-request-row="model:m"]');
    expect(model.findAll('button').map(button => button.attributes('data-request-select') !== undefined)).toStrictEqual([
      true,
      false
    ]);

    // 按钮的回车、空格就是点击
    await name.trigger('click');
    await model.get('button[aria-label="重新加载：model:m 的名称"]').trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['resource:a']]);
    expect(wrapper.emitted('retry')).toStrictEqual([['model:m']]);
  });

  it('明细贴着资源图层面板的右边、底边在状态栏上方：条目左右移时不动（用户 2026-11-16）', async () => {
    const area = placed(16, 72, 1264, 760);
    const panel = placed(16, 72, 336, 724);
    const { wrapper } = mountChip([item('a')]);
    await wrapper.setProps({ panel: () => panel, area: () => area });
    const chip = wrapper.get('[data-request-status]').element;
    let chipLeft = 400;
    chip.getBoundingClientRect = () => new DOMRect(chipLeft, 736, 120, 24);

    await wrapper.get('[data-request-chip]').trigger('click');
    const style = () => wrapper.get<HTMLElement>('[data-request-popover]').element.style;
    // jsdom 的视口高 768：底边在条目上边 736 再往上 8
    expect([style().left, style().bottom, style().width, style().maxHeight]).toStrictEqual([
      '344px',
      '40px',
      '340px',
      '420px'
    ]);

    // 经纬度变宽，条目右移
    chipLeft = 520;
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(style().left).toBe('344px');
  });

  it('面板展开、收起时明细跟着面板的右边走：页面给的一直是同一个元素，靠尺寸监听；明细关着时不监听', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const area = placed(16, 72, 1264, 760);
    let right = 40;
    const panel = document.body.appendChild(document.createElement('div'));
    panel.getBoundingClientRect = () => new DOMRect(16, 72, right - 16, 652);
    const { wrapper } = mountChip([item('a')]);
    await wrapper.setProps({ panel: () => panel, area: () => area });
    wrapper.get('[data-request-status]').element.getBoundingClientRect = () => new DOMRect(400, 736, 120, 24);
    expect(FakeResizeObserver.watching(panel)).toBe(false);

    await wrapper.get('[data-request-chip]').trigger('click');
    const left = () => wrapper.get<HTMLElement>('[data-request-popover]').element.style.left;
    expect(left()).toBe('48px');

    // 在明细里点了一行，页面把竖条展开：元素不变，宽度变了
    right = 336;
    FakeResizeObserver.resized(panel);
    await nextTick();
    expect(left()).toBe('344px');

    await wrapper.get('[data-request-chip]').trigger('click');
    expect(FakeResizeObserver.watching(panel)).toBe(false);
  });

  it('关掉加载失败（ADR 0167）：条目不说失败，明细没有有失败一组；都以失败结束时明细跟着关上', async () => {
    const shown = { loading: true, failed: false, done: true };
    const { wrapper, items, clock } = mountChip([item('a'), item('b', { failed: 1, loaded: 5 })], 1000, shown);
    const chip = wrapper.get('[data-request-chip]');
    expect(chip.text()).toBe('正在加载 2 项 · 50%');
    expect(chip.find('[aria-label="1 项有失败"]').exists()).toBe(false);

    items.value = [item('a', { loaded: 10, finishedAt: 900 }), item('b', { failed: 1, loaded: 9, finishedAt: 900 })];
    clock.value = 1000;
    await nextTick();
    await wrapper.get('[data-request-chip]').trigger('click');
    expect(wrapper.get('[data-request-popover]').findAll('li').map(row => row.text())).toStrictEqual([
      '已完成',
      'a 的名称10 张'
    ]);

    items.value = [item('b', { failed: 1, loaded: 9, finishedAt: 900 })];
    await nextTick();
    await nextTick();
    expect(wrapper.find('[data-request-status]').exists()).toBe(false);
  });

  it('三类都关掉时条目不出现', async () => {
    const shown = { loading: false, failed: false, done: false };
    const { wrapper } = mountChip([item('a'), item('b', { failed: 2, loaded: 8, finishedAt: 900 })], 1000, shown);
    await nextTick();
    expect(wrapper.find('[data-request-status]').exists()).toBe(false);
  });

  it('上一轮有失败、这一轮还在加载的项在加载中、有失败两组里都有：加载中写这一轮的进度，有失败写上一轮的张数（用户 2026-11-22）', async () => {
    const { wrapper } = mountChip([item('resource:a', { previousFailed: 2 })]);
    await wrapper.get('[data-request-chip]').trigger('click');
    expect(wrapper.get('[data-request-popover]').findAll('li').map(row => row.text())).toStrictEqual([
      '加载中',
      'resource:a 的名称4/10 张',
      '有失败',
      'resource:a 的名称2 张失败'
    ]);
  });

  it('明细开着时加载都结束了也留着条目（已加载完成），关上后不再显示', async () => {
    const { wrapper, items, clock, display } = mountChip([item('a')]);
    await wrapper.get('[data-request-chip]').trigger('click');
    // 这一次显示已经过去
    items.value = [item('a', { loaded: 10, finishedAt: 300 })];
    display.value = null;
    clock.value = 9000;
    await nextTick();
    expect(wrapper.get('[data-request-chip]').text()).toBe('已加载完成');
    expect(wrapper.find('[data-request-popover]').exists()).toBe(true);

    await wrapper.get('button[aria-label="关闭"]').trigger('click');
    expect(wrapper.find('[data-request-status]').exists()).toBe(false);
  });
});
