import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { LayerPanelShell } from './LayerPanelShell';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

const TABS = [
  { id: 'core', label: '主节点' },
  { id: 'report', label: '统计报表' }
];

// 页面持有收起、目录的状态；插槽给出可以认出来的内容
function mountShell(initial: 'ready' | 'loading' | 'failed' = 'ready') {
  const status = ref(initial);
  const collapsed = ref(false);
  const retries = ref(0);
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: CAMERA });
    return () =>
      h(
        LayerPanelShell,
        {
          title: '资源图层',
          tabs: TABS,
          status: status.value,
          collapsed: collapsed.value,
          ratio: 0.4,
          onRetry: () => retries.value++,
          'onUpdate:collapsed': (value: boolean) => (collapsed.value = value)
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
  return { wrapper: mount(Page), status, collapsed, retries };
}

describe('LayerPanelShell', () => {
  it('两段和分割线：目录、搜索行、当前图层、浮层都由插槽给出；分割线有无障碍名称', () => {
    const { wrapper } = mountShell();
    for (const slot of ['catalog-tools', 'filter', 'catalog', 'current-tools', 'current', 'floating']) {
      expect(wrapper.find(`[data-slot="${slot}"]`).exists()).toBe(true);
    }
    expect(wrapper.get('[data-panel-section="catalog"]').attributes('aria-label')).toBe('资源目录');
    expect(wrapper.get('[role="separator"]').attributes('aria-label')).toBe('调整资源目录和当前图层的高度');
  });

  it('目录还没到时目录这一段显示加载中，失败时显示失败和重试；只换掉目录，搜索行、浮层和当前图层照常（2026-11-15 审查：三维模型不受资源目录影响）', async () => {
    const { wrapper, status, retries } = mountShell('loading');
    expect(wrapper.get('[data-panel-section="catalog"]').text()).toContain('正在加载资源目录…');
    expect(wrapper.find('[data-slot="catalog"]').exists()).toBe(false);
    expect(wrapper.find('[data-slot="filter"]').exists()).toBe(true);
    expect(wrapper.find('[data-slot="floating"]').exists()).toBe(true);
    expect(wrapper.find('[data-slot="current"]').exists()).toBe(true);

    status.value = 'failed';
    await nextTick();
    expect(wrapper.text()).toContain('资源目录加载失败');
    await wrapper.findAll('button').find(button => button.text() === '重试')?.trigger('click');
    expect(retries.value).toBe(1);
  });

  it('其余页签显示"暂无数据"，切回主页签照常；收起后是竖条，点它展开', async () => {
    const { wrapper, collapsed } = mountShell();
    await wrapper.findAll('[role="tab"]')[1]?.trigger('click');
    expect(wrapper.text()).toContain('暂无数据');
    expect(wrapper.find('[data-panel-section]').exists()).toBe(false);
    await wrapper.findAll('[role="tab"]')[0]?.trigger('click');
    expect(wrapper.find('[data-panel-section="current"]').exists()).toBe(true);

    await wrapper.get('button[aria-label="收起资源图层"]').trigger('click');
    expect(collapsed.value).toBe(true);
    expect(wrapper.find('[data-panel-section]').exists()).toBe(false);
    await wrapper.get('button[aria-label="展开资源图层"]').trigger('click');
    expect(collapsed.value).toBe(false);
  });
});
