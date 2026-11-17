import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { required } from '../../testing/required';
import { DashboardShell, type DashboardShellScope } from './DashboardShell';

// jsdom 的图片不会解码，背景图的预解码换成立即完成
beforeEach(() => {
  vi.stubGlobal('Image', class {
    src = '';

    decode(): Promise<void> {
      return Promise.resolve();
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardShell', () => {
  it('标题、入场状态和缩放交给插槽，加载耗时按调用方给的名称记', async () => {
    const scopes: DashboardShellScope[] = [];
    const wrapper = mount(DashboardShell, {
      props: { title: '江苏省城市国土空间监测综合分析', traceName: 'shell-test', reducedMotion: true },
      slots: {
        default: (scope: DashboardShellScope) => {
          scopes.push(scope);
          return <div data-test="panels">三栏</div>;
        }
      }
    });
    expect(wrapper.get('h1').text()).toBe('江苏省城市国土空间监测综合分析');
    expect(wrapper.get('h1').attributes('data-enter')).toBe('title-text');
    expect(wrapper.attributes('data-dashboard-phase')).toBe('map-entering');
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('[data-test="panels"]').exists()).toBe(true);
    expect(performance.getEntriesByName('shell-test:start', 'mark')).toHaveLength(1);
    const scope = required(scopes.at(-1), '外壳插槽参数');
    expect(scope.density).toBe(1);
    // 减少动画时地图就绪后直接到终态
    await scope.entrance.mapSettled();
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes('data-dashboard-phase')).toBe('ready');
    expect(performance.getEntriesByName('shell-test:ready', 'measure')).toHaveLength(1);
  });

  it('Esc 交给调用方', async () => {
    const wrapper = mount(DashboardShell, { props: { title: '标题', traceName: 'shell-escape' } });
    await wrapper.trigger('keydown', { key: 'Enter' });
    await wrapper.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('escape')).toHaveLength(1);
  });
});
