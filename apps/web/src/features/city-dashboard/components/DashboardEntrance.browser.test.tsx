import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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

// 过渡状态只有几秒，机器慢时轮询会错过：在状态写进 DOM 的同一轮微任务里接住，这时动画还没走下一帧，
// 接下来的操作一定落在这个状态内。没经过它就到了 ready 时直接失败，不等到超时
function whenEntered(host: HTMLElement, attribute: string, state: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const current = host.querySelector(`[${attribute}]`)?.getAttribute(attribute);
      if (current === state) {
        resolve();
      } else if (current === 'ready') {
        reject(new Error(`${attribute} 没有经过 ${state} 就到了 ready`));
      }
    });
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: [attribute] });
    onTestFinished(() => observer.disconnect());
  });
}

describe('整屏入场生命周期', () => {
  it('地图先就绪，面板、数值和边框完成后恢复交互及弹层层叠', async () => {
    const host = createHost();
    const panelsEntering = whenEntered(host, 'data-dashboard-phase', 'panels-entering');
    const wrapper = mount(DashboardView, { attachTo: host, props: { forceFallback: true } });
    expect(wrapper.attributes('data-dashboard-phase')).toBe('map-entering');
    expect(wrapper.find('[aria-label="大屏筛选条件"]').attributes('inert')).toBeDefined();
    await panelsEntering;
    await vi.waitFor(() => expect(wrapper.attributes('data-dashboard-phase')).toBe('ready'), { timeout: 30000 });
    for (const group of wrapper.findAll('[data-filter-group], [data-enter="left"], [data-enter="title"]')) {
      expect((group.element as HTMLElement).style.transform).toBe('');
      expect(getComputedStyle(group.element).visibility).toBe('visible');
    }
    expect(wrapper.find('[aria-label="大屏筛选条件"]').attributes('inert')).toBeUndefined();
    expect((wrapper.get('[data-card-list]').element as HTMLElement).scrollTop).toBe(0);
    expect(wrapper.get('[data-scene="frame"]').element.getAttribute('style') ?? '').not.toContain('--frame-progress');
    wrapper.unmount();
    expect(document.querySelectorAll('[data-dashboard-phase]')).toHaveLength(0);
  }, 60000);

  it('入场中开启减少动画会结束全部阶段，卸载不会晚到恢复节点', async () => {
    const host = createHost();
    const mapEntering = whenEntered(host, 'data-state', 'entering');
    const wrapper = mount(DashboardView, { attachTo: host });
    await mapEntering;
    await wrapper.setProps({ reducedMotion: true });
    await vi.waitFor(() => expect(wrapper.attributes('data-dashboard-phase')).toBe('ready'), { timeout: 30000 });
    expect(wrapper.findAll('button[aria-haspopup="dialog"]')).toHaveLength(13);
    expect(wrapper.findAll('button[aria-haspopup="dialog"] > span')).toHaveLength(13);
    wrapper.unmount();
    await nextTick();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    const interrupted = mount(DashboardView, { attachTo: host });
    interrupted.unmount();
    await nextTick();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
  }, 60000);
});
