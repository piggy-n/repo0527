import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataQueryPage } from './DataQueryPage';

afterEach(() => {
  vi.unstubAllGlobals();
  // 浮层挂在 body 下，不随组件卸载
  document.body.innerHTML = '';
});

// jsdom 没有 matchMedia：窄屏时模拟一个始终匹配的版本，否则按宽屏
function stubNarrow() {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }));
}

// 画布用真实的 MapLibre，jsdom 里创建不出来；这里只看地图上的工具
function mountPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(DataQueryPage, {
    props: { topic: 'space-monitoring' },
    global: { plugins: [createPinia(), [VueQueryPlugin, { queryClient }]], stubs: { MapCanvas: true } },
    attachTo: document.body
  });
}

const ENTRY = '[aria-label="地图视角"] button[aria-label="行政区边界"]';
const popover = () => {
  const element = document.querySelector('[data-map-options="boundaries"]');
  return element instanceof HTMLElement ? new DOMWrapper(element) : null;
};
const popoverShown = () => popover()?.isVisible() === true;
const levelChecked = (label: string) =>
  popover()?.get<HTMLInputElement>(`label[aria-label="${label}"] input`).element.checked;
const pressed = (wrapper: VueWrapper) => wrapper.get(ENTRY).attributes('aria-pressed');

describe('DataQueryPage 的行政区边界', () => {
  it('入口在控制栏，没有单独的工具栏；默认只显示省界，底图卡还在', async () => {
    const wrapper = mountPage();
    expect(wrapper.findAll('[role="toolbar"]')).toHaveLength(1);
    expect(wrapper.find('button[aria-label^="底图："]').exists()).toBe(true);
    expect(popoverShown()).toBe(false);

    await wrapper.get(ENTRY).trigger('click');
    expect(pressed(wrapper)).toBe('true');
    await vi.waitFor(() => expect(popoverShown()).toBe(true));
    expect(levelChecked('省界')).toBe(true);
    expect(levelChecked('市界')).toBe(false);
    expect(levelChecked('县界')).toBe(false);
  });

  it('窄屏时点入口让出左边；展开查询面板时浮层隐藏，打开的状态保留', async () => {
    stubNarrow();
    const wrapper = mountPage();
    const toggleLeft = (label: string) => wrapper.get(`button[aria-label="${label}"]`).trigger('click');
    // 先收起再展开查询面板：最后操作的是左边
    await toggleLeft('收起城市国土空间监测查询');
    await toggleLeft('展开城市国土空间监测查询');

    await wrapper.get(ENTRY).trigger('click');
    await vi.waitFor(() => expect(popoverShown()).toBe(true));
    expect(wrapper.find('button[aria-label="展开城市国土空间监测查询"]').exists()).toBe(true);

    await toggleLeft('展开城市国土空间监测查询');
    expect(pressed(wrapper)).toBe('false');
    await vi.waitFor(() => expect(popoverShown()).toBe(false));

    await wrapper.get(ENTRY).trigger('click');
    expect(pressed(wrapper)).toBe('true');
    await vi.waitFor(() => expect(popoverShown()).toBe(true));
  });
});
