import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { computed, nextTick, shallowRef } from 'vue';
import type { RequestItem } from './request-status';
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
  startedAt: 0,
  finishedAt: null,
  ...extra
});

// 状态由用例直接改
function mountChip(initial: readonly RequestItem[], now = 1000) {
  const items = shallowRef(initial);
  const clock = shallowRef(now);
  const status: RequestStatus = {
    items: computed(() => items.value),
    now: clock,
    loadingKeys: computed(() => new Set<string>())
  };
  const wrapper = mount(RequestStatusChip, {
    props: { status, selectable: (key: string) => key !== 'basemap' },
    attachTo: document.body
  });
  return { wrapper, items, clock };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RequestStatusChip', () => {
  it('空闲时什么也不显示；加载超过 0.4 秒显示项数和比例，有失败时带红点；结束后显示失败的项数', async () => {
    const { wrapper, items, clock } = mountChip([]);
    expect(wrapper.find('[data-request-status]').exists()).toBe(false);

    items.value = [item('a'), item('b', { failed: 1, loaded: 5 })];
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

  it('明细开着时加载都结束了也留着条目（已加载完成），关上后不再显示', async () => {
    const { wrapper, items, clock } = mountChip([item('a')]);
    await wrapper.get('[data-request-chip]').trigger('click');
    items.value = [item('a', { loaded: 10, finishedAt: 300 })];
    clock.value = 9000;
    await nextTick();
    expect(wrapper.get('[data-request-chip]').text()).toBe('已加载完成');
    expect(wrapper.find('[data-request-popover]').exists()).toBe(true);

    await wrapper.get('button[aria-label="关闭"]').trigger('click');
    expect(wrapper.find('[data-request-status]').exists()).toBe(false);
  });
});
