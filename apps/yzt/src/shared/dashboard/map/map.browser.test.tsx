import { mount } from '@vue/test-utils';
import type { MapSeriesOption } from 'echarts/charts';
import { getInstanceByDom } from 'echarts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INDICATORS, requireIndicator, type Indicator } from '../../city-indicators/catalog';
import { indicatorValue } from '../../city-indicators/indicator-value';
import { required } from '../../testing/required';
import { DASHBOARD_CITIES } from '../cities';
import { createMapClassification } from '../map-classification';
import tooltipStyles from '../tooltip/TooltipLayer.module.scss';
import { DashboardMap } from './DashboardMap';
import { JiangsuMapScene } from './JiangsuMapScene';
import { loadDashboardRegions } from './region-geometry';
import type { MapView, SceneCallbacks } from './types';

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach(element => element.remove());
});

// 与原驾驶舱的默认筛选一致：2025、2026 两年，全部城市，地图显示 2026 年
function mapProps(indicator: Indicator) {
  const values = Object.fromEntries(
    DASHBOARD_CITIES.map(city => [city.code, indicatorValue(city.code, indicator, 2026)])
  );
  return {
    indicator,
    title: `2026年江苏省${indicator.name}分布图（${indicator.unit}）`,
    values,
    classification: createMapClassification(Object.values(values)),
    years: [2025, 2026],
    activeYear: 2026
  };
}

function host(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cssText = 'position:relative;width:900px;height:700px';
  document.body.append(element);
  hosts.push(element);
  return element;
}

describe('驾驶舱真实地图引擎', () => {
  it('窄地图的多行标题与固定提示表格保留间距', async () => {
    const indicator = required(INDICATORS.find(item => item.name.startsWith('每10万人拥有的博物馆')), '博物馆指标');
    const wrapper = mount(DashboardMap, {
      attachTo: host(),
      props: { ...mapProps(indicator), reducedMotion: true, active: true, forceFallback: true },
      attrs: { style: 'width:366px;height:600px;--ui-scale:0.9' },
      slots: { default: () => <div class={tooltipStyles.tooltip} data-dashboard-tooltip>城市数据表格</div> }
    });
    try {
      await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'), { timeout: 10000 });
      const title = wrapper.get('[data-enter="map-title"]').element.getBoundingClientRect();
      const tooltip = wrapper.get('[data-dashboard-tooltip]').element.getBoundingClientRect();
      expect(title.height).toBeGreaterThan(60);
      expect(tooltip.top - title.bottom).toBeGreaterThanOrEqual(11);
    } finally {
      wrapper.unmount();
    }
  });

  it('空闲和隐藏时不重绘，扫光不重复发布静止标签，销毁结束定时动画', async () => {
    const element = host();
    const data = await loadDashboardRegions(new AbortController().signal);
    const labels = vi.fn<SceneCallbacks['onLabels']>();
    const rendered = vi.spyOn(WebGL2RenderingContext.prototype, 'clear');
    const scene = new JiangsuMapScene(element, data.regions, {
      onLabels: labels,
      onHover: () => {
      },
      onCityClick: () => {
      },
      onCityPointer: () => {
      },
      onFailure: () => {
      }
    });
    try {
      await scene.playEntrance(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const renders = rendered.mock.calls.length;
      const publications = labels.mock.calls.length;
      // 取样窗口确认无操作时没有引擎重绘，而非等待某个异步事件
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(rendered.mock.calls.length).toBe(renders);
      scene.updateValues(Object.fromEntries(data.regions.map(region => [region.code, 80])), 0.1);
      await vi.waitFor(() => expect(rendered.mock.calls.length).toBeGreaterThan(renders));
      expect(labels.mock.calls.length).toBe(publications);
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
      const hiddenRenders = rendered.mock.calls.length;
      scene.resize();
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(rendered.mock.calls.length).toBe(hiddenRenders);
      vi.restoreAllMocks();
      document.dispatchEvent(new Event('visibilitychange'));
      scene.setReducedMotion(false);
    } finally {
      scene.dispose();
      vi.restoreAllMocks();
    }
    expect(element.querySelectorAll('canvas')).toHaveLength(0);
  }, 10000);

  it('截图同步拟合新尺寸，释放后画布移除并结束未完成入场', async () => {
    const element = host();
    const data = await loadDashboardRegions(new AbortController().signal);
    const labels = vi.fn<SceneCallbacks['onLabels']>();
    const scene = new JiangsuMapScene(element, data.regions, {
      onLabels: labels,
      onHover: () => {
      },
      onCityClick: () => {
      },
      onCityPointer: () => {
      },
      onFailure: () => {
      }
    });
    try {
      await scene.playEntrance(true);
      scene.updateValues(Object.fromEntries(data.regions.map(region => [region.code, 50])));
      element.style.width = '600px';
      const canvas = scene.capture();
      expect(canvas.width).toBe(1200);
      expect(canvas.height).toBe(1400);
      expect(labels.mock.lastCall?.[0]).toHaveLength(13);
      const pixels = required(canvas.getContext('2d'), '二维画布').getImageData(0, 0, canvas.width, canvas.height).data;
      expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      const pending = scene.playEntrance();
      scene.dispose();
      await pending;
      expect(element.querySelector('canvas')).toBeNull();
    } finally {
      scene.dispose();
    }
  }, 15000);

  it('不显示数值时三维标签、二维降级都只写名称，状态提示和叠加插槽照常显示，没有档位时不留图例框', async () => {
    const wrapper = mount(DashboardMap, {
      attachTo: host(),
      props: { ...mapProps(requireIndicator('A-15')), reducedMotion: true, showValues: false, notice: '原报告未列指数值' },
      attrs: { style: 'width:900px;height:700px' },
      slots: { topRight: (view: MapView | null) => <div data-test="overlay">{view ? '有视图' : '没有视图'}</div> }
    });
    await vi.waitFor(() => expect(wrapper.findAll('button[aria-haspopup="dialog"]')).toHaveLength(13), {
      timeout: 10000
    });
    expect(wrapper.findAll('button[aria-haspopup="dialog"] > span')).toHaveLength(0);
    expect(wrapper.find('button[aria-label="南京市，查看详情"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('原报告未列指数值');
    await vi.waitFor(() => expect(wrapper.get('[data-test="overlay"]').text()).toBe('有视图'));
    const canvas = wrapper.get('canvas').element as HTMLCanvasElement;
    const context = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
    required(context.getExtension('WEBGL_lose_context'), 'WEBGL_lose_context 扩展').loseContext();
    await vi.waitFor(() => expect(wrapper.text()).toContain('地图采用简化显示'));
    // 二维降级的标签由 ECharts 画在画布上，读它的格式化函数
    const chart = required(getInstanceByDom(wrapper.get('[role="img"]').element as HTMLElement), '二维地图');
    const label = (name: string) => {
      const [series] = chart.getOption().series as MapSeriesOption[];
      const formatter = series.label?.formatter;
      if (typeof formatter !== 'function') {
        throw new Error('二维地图的标签缺少格式化函数');
      }
      return formatter({ name } as never);
    };
    expect(label('南京市')).toBe('南京市');
    await wrapper.setProps({ showValues: true });
    expect(label('南京市')).toMatch(/^南京市\n\d/);
    // 没有一个城市有值时没有档位，不留空的图例框
    expect(wrapper.find('[aria-label="地图数值分级"]').exists()).toBe(true);
    await wrapper.setProps({
      values: Object.fromEntries(DASHBOARD_CITIES.map(city => [city.code, null])),
      classification: createMapClassification([])
    });
    expect(wrapper.find('[aria-label="地图数值分级"]').exists()).toBe(false);
  }, 20000);

  it('运行中失去 WebGL 自动降为二维，重复进入退出不遗留画布', async () => {
    const element = host();
    for (let index = 0; index < 3; index++) {
      const wrapper = mount(DashboardMap, {
        attachTo: element,
        props: { ...mapProps(requireIndicator('A-15')), reducedMotion: true },
        attrs: { style: 'width:900px;height:700px' }
      });
      try {
        // oxlint-disable-next-line no-await-in-loop -- 连续创建和释放同一容器，验证上一轮资源已清理
        await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'), { timeout: 10000 });
        // 装饰圆环超出容器不能使聚焦操作滚走地图标题
        const mapElement = wrapper.element as HTMLElement;
        mapElement.scrollTop = 100;
        expect(mapElement.scrollTop).toBe(0);
        const canvas = wrapper.get('canvas').element as HTMLCanvasElement;
        const context = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
        required(context.getExtension('WEBGL_lose_context'), 'WEBGL_lose_context 扩展').loseContext();
        // oxlint-disable-next-line no-await-in-loop -- 本轮降级完成后才能验证释放及下一轮
        await vi.waitFor(() => expect(wrapper.text()).toContain('地图采用简化显示'));
        expect(wrapper.findAll('canvas')).toHaveLength(1);
        expect(wrapper.find('[aria-label="消防救援5分钟可达覆盖率二维分布图"]').exists()).toBe(true);
        // 清空年份：标题、时间轴和数值都由调用方一起改
        // oxlint-disable-next-line no-await-in-loop -- 本轮清空年份后才能检查标题
        await wrapper.setProps({
          title: '请选择年份',
          values: Object.fromEntries(DASHBOARD_CITIES.map(city => [city.code, null])),
          years: [],
          activeYear: null
        });
        // oxlint-disable-next-line no-await-in-loop -- 卸载前确认本轮筛选收敛
        await vi.waitFor(() => expect(wrapper.text()).toContain('请选择年份'));
      } finally {
        wrapper.unmount();
      }
      expect(element.querySelectorAll('canvas')).toHaveLength(0);
    }
  }, 30000);
});
