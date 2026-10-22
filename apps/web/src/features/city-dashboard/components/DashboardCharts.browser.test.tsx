import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createMockData } from '../data/mock-data';
import { useDashboard } from '../composables/useDashboard';
import { DashboardCharts, type DashboardChartsHandle } from './DashboardCharts';
import { DashboardFilters } from './DashboardFilters';

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach(host => host.remove());
});

describe('驾驶舱真实列表布局', () => {
  it('矮屏保留指标内部滚动且不压缩长名称行高', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'width:323px;height:470px';
    document.body.append(host);
    hosts.push(host);
    const model = useDashboard(createMockData(2026));
    model.selectCategory('happiness');
    const wrapper = mount(DashboardFilters, { attachTo: host, props: { model }, attrs: { style: 'height:470px' } });
    await nextTick();
    const list = wrapper.get('[aria-label="具体指标列表"]').element as HTMLElement;
    expect(list.clientHeight).toBeGreaterThanOrEqual(130);
    expect(list.clientHeight).toBeLessThan(200);
    expect(list.scrollHeight).toBeGreaterThan(1000);
    const longButton = [...list.querySelectorAll('button')].find(button => button.textContent.includes('每10万人'))!;
    expect(longButton.scrollHeight).toBeLessThanOrEqual(longButton.clientHeight + 1);
  });

  it('多次重渲染后 End 仍滚到真实末尾且不改变当前指标', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'width:420px;height:600px;position:relative';
    document.body.append(host);
    hosts.push(host);
    const model = useDashboard(createMockData(2026));
    model.selectCategory('happiness');
    const wrapper = mount(DashboardCharts, { attachTo: host, props: { model }, attrs: { style: 'height:600px' } });
    await nextTick();
    model.selectIndicator('B-63');
    await nextTick();
    model.setYears([2021, 2022, 2023, 2024, 2025, 2026]);
    await nextTick();
    const region = wrapper.get('[aria-label="指标图表列表，使用上下方向键逐项切换"]');
    const element = region.element as HTMLElement;
    expect(element.scrollHeight).toBeGreaterThan(element.clientHeight + 1000);
    await region.trigger('keydown', { key: 'End' });
    await vi.waitFor(() => expect(element.scrollTop).toBeGreaterThan(element.scrollHeight - element.clientHeight - 2));
    expect(model.state.value.indicatorId).toBe('B-63');
    await region.trigger('keydown', { key: 'Home' });
    await vi.waitFor(() => expect(element.scrollTop).toBeLessThan(2), { timeout: 5000 });
  });

  it('惯性只翻一张、反向打断，连续指标定位只完成最后一个', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'width:420px;height:600px;position:relative';
    document.body.append(host);
    hosts.push(host);
    const model = useDashboard(createMockData(2026));
    model.selectCategory('happiness');
    const wrapper = mount(DashboardCharts, { attachTo: host, props: { model }, attrs: { style: 'height:600px' } });
    const list = wrapper.get('[data-card-list]').element as HTMLElement;
    const cards = [...list.querySelectorAll<HTMLElement>('[data-chart-id]')];
    // 首次尺寸观察完成后再输入真实滚轮序列
    await vi.waitFor(() => expect(list.clientHeight).toBe(600));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const wheel = (deltaY: number, extra = {}) => list.dispatchEvent(new WheelEvent(
      'wheel',
      { deltaY, bubbles: true, cancelable: true, ...extra }
    ));
    wheel(30);
    wheel(22);
    wheel(12);
    wheel(4);
    await vi.waitFor(() => expect(Math.abs(list.scrollTop - cards[1].offsetTop)).toBeLessThan(2), { timeout: 5000 });
    wheel(-40);
    await vi.waitFor(() => expect(list.scrollTop).toBeLessThan(2), { timeout: 5000 });
    expect(wheel(100, { ctrlKey: true })).toBe(true);
    expect(wheel(10, { deltaX: 100 })).toBe(true);
    const handle = wrapper.vm as unknown as DashboardChartsHandle;
    handle.locateIndicator(cards[5].dataset.chartId!);
    handle.locateIndicator(cards[2].dataset.chartId!);
    await vi.waitFor(() => expect(Math.abs(list.scrollTop - cards[2].offsetTop)).toBeLessThan(2), { timeout: 5000 });
    handle.locateIndicator(cards[6].dataset.chartId!);
    model.selectCategory('resilience');
    await vi.waitFor(() => expect(list.scrollTop).toBeLessThan(2));
    expect(list.style.scrollSnapType).toBe('');
    wrapper.unmount();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
  });
});
