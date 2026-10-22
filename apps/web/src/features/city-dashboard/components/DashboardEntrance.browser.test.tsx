import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { DashboardView } from './DashboardView';

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach(host => host.remove());
  vi.unstubAllGlobals();
});

function createHost(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  return host;
}

describe('整屏入场生命周期', () => {
  it('地图先就绪，面板、数值和边框完成后恢复交互及弹层层叠', async () => {
    const wrapper = mount(DashboardView, { attachTo: createHost(), props: { forceFallback: true } });
    expect(wrapper.attributes('data-dashboard-phase')).toBe('map-entering');
    expect(wrapper.find('[aria-label="大屏筛选条件"]').attributes('inert')).toBeDefined();
    await vi.waitFor(
      () => expect(wrapper.attributes('data-dashboard-phase')).toBe('panels-entering'),
      { timeout: 10000 }
    );
    await vi.waitFor(() => expect(wrapper.attributes('data-dashboard-phase')).toBe('ready'), { timeout: 10000 });
    for (const group of wrapper.findAll('[data-filter-group], [data-enter="left"], [data-enter="title"]')) {
      expect((group.element as HTMLElement).style.transform).toBe('');
      expect(getComputedStyle(group.element).visibility).toBe('visible');
    }
    expect(wrapper.find('[aria-label="大屏筛选条件"]').attributes('inert')).toBeUndefined();
    expect((wrapper.get('[data-card-list]').element as HTMLElement).scrollTop).toBe(0);
    expect(wrapper.get('[data-scene="frame"]').element.getAttribute('style') ?? '').not.toContain('--frame-progress');
    wrapper.unmount();
    expect(document.querySelectorAll('[data-dashboard-phase]')).toHaveLength(0);
  }, 20000);

  it('入场中开启减少动画会结束全部阶段，卸载不会晚到恢复节点', async () => {
    const host = createHost();
    const wrapper = mount(DashboardView, { attachTo: host });
    await vi.waitFor(
      () => expect(wrapper.get('[data-state]').attributes('data-state')).toBe('entering'),
      { timeout: 10000 }
    );
    await wrapper.setProps({ reducedMotion: true });
    await vi.waitFor(() => expect(wrapper.attributes('data-dashboard-phase')).toBe('ready'), { timeout: 10000 });
    expect(wrapper.findAll('button[aria-haspopup="dialog"]')).toHaveLength(13);
    expect(wrapper.findAll('button[aria-haspopup="dialog"] > span')).toHaveLength(13);
    wrapper.unmount();
    await nextTick();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    const interrupted = mount(DashboardView, { attachTo: host });
    interrupted.unmount();
    await nextTick();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
  }, 20000);
});
