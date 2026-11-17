import { mount } from '@vue/test-utils';
import { getInstanceByDom } from 'echarts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { required } from '../../testing/required';
import { DASHBOARD_CITIES } from '../cities';
import { DashboardPlot } from './DashboardPlot';
import { createRadarOption } from './radar-options';

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach(element => element.remove());
});

describe('雷达图在真实引擎里', () => {
  it('运行时注册了雷达，画出所选城市的轴和数据面', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'width:420px;height:260px';
    document.body.append(host);
    hosts.push(host);
    const option = createRadarOption({
      indicator: { id: 'I02', name: '教育便利性指数', unit: '', precision: 2 },
      color: () => '#1849A9',
      cities: DASHBOARD_CITIES,
      comparison: [{ year: 2025, values: DASHBOARD_CITIES.map((_, index) => 0.4 + index * 0.03), average: 0.58 }],
      preference: { type: 'radar', showAverage: true, legend: {} }
    });
    const wrapper = mount(DashboardPlot, {
      attachTo: host,
      props: { option, cities: DASHBOARD_CITIES, description: '教育便利性指数', hoverMode: 'none' },
      attrs: { style: 'width:420px;height:260px' }
    });
    const element = wrapper.element as HTMLElement;
    await vi.waitFor(() => expect(element.querySelector('canvas')).not.toBeNull());
    // 没注册的组件、系列不会出现在引擎合并后的配置里
    const rendered = required(getInstanceByDom(element), '雷达图实例').getOption();
    expect(rendered.radar).toHaveLength(1);
    expect((rendered.series as { type?: string }[]).map(item => item.type)).toEqual(['radar', 'radar']);
    const canvas = required(element.querySelector('canvas'), '雷达图画布');
    const pixels = required(canvas.getContext('2d'), '二维画布').getImageData(0, 0, canvas.width, canvas.height).data;
    expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });
});
