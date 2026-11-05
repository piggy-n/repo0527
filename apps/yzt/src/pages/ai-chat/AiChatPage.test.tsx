import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { AiResultPanel } from '@/features/ai-chat/components/AiResultPanel';
import { AiChatPage } from './AiChatPage';

afterEach(() => {
  // 浮层挂在 body 下，不随组件卸载
  document.body.innerHTML = '';
});

// 画布用真实的 MapLibre，jsdom 里创建不出来；这里只看地图上的工具，对话面板也换成空的替身
function mountPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(AiChatPage, {
    global: { plugins: [createPinia(), [VueQueryPlugin, { queryClient }]], stubs: { MapCanvas: true, ChatPanel: true } },
    attachTo: document.body
  });
}

const ENTRY = '[aria-label="地图视角"] button[aria-label="行政区边界"]';
const popover = () => {
  const element = document.querySelector('[data-map-options="boundaries"]');
  return element instanceof HTMLElement ? new DOMWrapper(element) : null;
};
const levelChecked = (label: string) =>
  popover()?.get<HTMLInputElement>(`label[aria-label="${label}"] input`).element.checked;

async function openPopover(wrapper: VueWrapper) {
  await wrapper.get(ENTRY).trigger('click');
  await vi.waitFor(() => expect(popover()?.isVisible()).toBe(true));
}

describe('AiChatPage 的行政区边界', () => {
  it('入口在控制栏，默认只显示省界；可以打开其他级别', async () => {
    const wrapper = mountPage();
    expect(wrapper.findAll('[role="toolbar"]')).toHaveLength(1);

    await openPopover(wrapper);
    expect(wrapper.get(ENTRY).attributes('aria-pressed')).toBe('true');
    expect(levelChecked('省界')).toBe(true);
    expect(levelChecked('市界')).toBe(false);
    expect(levelChecked('县界')).toBe(false);

    await popover()?.get('label[aria-label="市界"] input').setValue(true);
    expect(levelChecked('市界')).toBe(true);
  });

  it('结果最大化时控制栏不显示，浮层一并关上；恢复后入口没有按下，勾选的级别还在', async () => {
    const wrapper = mountPage();
    await openPopover(wrapper);
    await popover()?.get('label[aria-label="县界"] input').setValue(true);
    const result = wrapper.getComponent(AiResultPanel);

    result.vm.$emit('update:maximized', true);
    await nextTick();
    expect(wrapper.find(ENTRY).exists()).toBe(false);
    await vi.waitFor(() => expect(popover()?.isVisible() ?? false).toBe(false));

    result.vm.$emit('update:maximized', false);
    await nextTick();
    expect(wrapper.get(ENTRY).attributes('aria-pressed')).toBe('false');

    await openPopover(wrapper);
    expect(levelChecked('县界')).toBe(true);
  });
});
