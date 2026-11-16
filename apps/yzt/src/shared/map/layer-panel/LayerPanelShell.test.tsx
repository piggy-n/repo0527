import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { required } from '../../testing/required';
import { LayerPanelShell, type PanelTab } from './LayerPanelShell';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

// 页面持有收起、目录的状态和显示的内容；插槽给出可以认出来的内容
function mountShell(initial: 'ready' | 'loading' | 'failed' = 'ready', views: readonly PanelTab[] = []) {
  const status = ref(initial);
  const collapsed = ref(false);
  const retries = ref(0);
  const view = ref(views[0]?.id ?? '');
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: CAMERA });
    return () =>
      h(
        LayerPanelShell,
        {
          title: '资源图层',
          status: status.value,
          collapsed: collapsed.value,
          ratio: 0.4,
          views,
          view: view.value,
          onRetry: () => retries.value++,
          'onUpdate:collapsed': (value: boolean) => (collapsed.value = value),
          'onUpdate:view': (value: string) => (view.value = value)
        },
        {
          catalogTools: () => [h('span', { 'data-slot': 'catalog-tools' })],
          catalogFilter: () => [h('span', { 'data-slot': 'filter' })],
          catalog: () => [h('span', { 'data-slot': 'catalog' }, '目录')],
          currentTools: () => [h('span', { 'data-slot': 'current-tools' })],
          current: () => [h('span', { 'data-slot': 'current' }, '当前')],
          floating: () => [h('span', { 'data-slot': 'floating' })]
        }
      );
  });
  return { wrapper: mount(Page), status, collapsed, retries, view };
}

const VIEWS: readonly PanelTab[] = [
  { id: 'all', label: '全部', count: 6 },
  { id: 'resources', label: '二维资源', count: null },
  { id: 'models', label: '三维模型', count: 0 }
];

describe('LayerPanelShell', () => {
  it('两段和分割线：资源、搜索行、图层、浮层都由插槽给出；两段的标题是"资源""图层"（用户 2026-11-16），分割线有无障碍名称', () => {
    const { wrapper } = mountShell();
    for (const slot of ['catalog-tools', 'filter', 'catalog', 'current-tools', 'current', 'floating']) {
      expect(wrapper.find(`[data-slot="${slot}"]`).exists()).toBe(true);
    }
    const catalog = wrapper.get('[data-panel-section="catalog"]');
    const current = wrapper.get('[data-panel-section="current"]');
    expect(catalog.attributes('aria-label')).toBe('资源');
    expect(current.attributes('aria-label')).toBe('图层');
    expect(catalog.element.firstElementChild?.textContent).toBe('资源');
    expect(current.element.firstElementChild?.textContent).toBe('图层');
    expect(wrapper.get('[role="separator"]').attributes('aria-label')).toBe('调整资源和图层的高度');
    // 没有给显示的内容时没有标签行
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
  });

  it('显示的内容是搜索行下面一行带数量的标签（用户 2026-11-16 选的丁）：标题行里没有；数量为 null 时只有名称；点了交给页面', async () => {
    const { wrapper, view } = mountShell('ready', VIEWS);
    const catalog = wrapper.get('[data-panel-section="catalog"]');
    const tablist = catalog.get('[role="tablist"]');
    expect(tablist.attributes('aria-label')).toBe('资源显示的内容');
    // 标题行（第一个子元素）里没有标签，标签行在搜索行后面
    expect(catalog.element.firstElementChild?.querySelector('[role="tab"]')).toBeNull();
    const filter = required(wrapper.get('[data-slot="filter"]').element.parentElement, '搜索行');
    expect(filter.compareDocumentPosition(tablist.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filter.contains(tablist.element)).toBe(false);

    const tabs = tablist.findAll('[role="tab"]');
    expect(tabs.map(tab => tab.attributes('aria-label'))).toStrictEqual(['全部 6 项', '二维资源', '三维模型 0 项']);
    expect(tabs.map(tab => tab.text())).toStrictEqual(['全部6', '二维资源', '三维模型0']);
    expect(tabs.map(tab => tab.attributes('aria-selected'))).toStrictEqual(['true', 'false', 'false']);
    expect(tabs.map(tab => tab.attributes('data-catalog-view'))).toStrictEqual(['all', 'resources', 'models']);

    await required(tabs[2], '三维模型').trigger('click');
    expect(view.value).toBe('models');
    expect(tablist.findAll('[role="tab"]').map(tab => tab.attributes('aria-selected'))).toStrictEqual([
      'false',
      'false',
      'true'
    ]);
  });

  it('资源还没到时这一段显示加载中，失败时显示失败和重试；只换掉目录，搜索行、标签行、浮层和图层照常（2026-11-15 审查：三维模型不受资源目录影响）', async () => {
    const { wrapper, status, retries } = mountShell('loading', VIEWS);
    expect(wrapper.get('[data-panel-section="catalog"]').text()).toContain('正在加载资源…');
    expect(wrapper.find('[data-slot="catalog"]').exists()).toBe(false);
    expect(wrapper.find('[data-slot="filter"]').exists()).toBe(true);
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true);
    expect(wrapper.find('[data-slot="floating"]').exists()).toBe(true);
    expect(wrapper.find('[data-slot="current"]').exists()).toBe(true);

    status.value = 'failed';
    await nextTick();
    expect(wrapper.text()).toContain('资源加载失败');
    expect(wrapper.text()).not.toContain('资源目录');
    await wrapper.findAll('button').find(button => button.text() === '重试')?.trigger('click');
    expect(retries.value).toBe(1);
  });

  it('头部只有标题和收起，没有页签（用户 2026-11-15 删掉了主节点、统计报表、分节点资源）；收起后是竖条，点它展开', async () => {
    const { wrapper, collapsed } = mountShell();
    const header = wrapper.get('header');
    expect(header.text()).toBe('资源图层');
    expect(header.findAll('button').map(button => button.attributes('aria-label'))).toStrictEqual(['收起资源图层']);
    expect(wrapper.find('[role="tab"]').exists()).toBe(false);

    await wrapper.get('button[aria-label="收起资源图层"]').trigger('click');
    expect(collapsed.value).toBe(true);
    expect(wrapper.find('[data-panel-section]').exists()).toBe(false);
    await wrapper.get('button[aria-label="展开资源图层"]').trigger('click');
    expect(collapsed.value).toBe(false);
  });
});
