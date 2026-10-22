import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JiangsuMapScene } from './JiangsuMapScene';
import { loadDashboardRegions } from './region-geometry';
import { DashboardMap } from '../components/DashboardMap';
import { useDashboard } from '../composables/useDashboard';
import { createMockData } from '../data/mock-data';
import type { SceneCallbacks } from './types';
import viewStyles from '../components/DashboardView.module.scss';

const hosts: HTMLElement[] = [];
afterEach(() => { hosts.splice(0).forEach(element => element.remove()); });

function host(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cssText = 'position:relative;width:900px;height:700px';
  document.body.append(element);
  hosts.push(element);
  return element;
}

describe('驾驶舱真实地图引擎', () => {
  it('窄地图的多行标题与固定提示表格保留间距', async () => {
    const model = useDashboard(createMockData(2026));
    model.selectCategory('happiness');
    const indicator = model.category.value.indicators.find(item => item.name.startsWith('每10万人拥有的博物馆'))!;
    model.selectIndicator(indicator.id);
    const wrapper = mount(DashboardMap, {
      attachTo: host(), props: { model, reducedMotion: true, active: true, forceFallback: true },
      attrs: { style: 'width:366px;height:600px;--ui-scale:.9' },
      slots: { default: () => <div class={viewStyles.tooltip} data-dashboard-tooltip>城市数据表格</div> }
    });
    try {
      await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'), { timeout: 10000 });
      const title = wrapper.get('[data-enter="map-title"]').element.getBoundingClientRect();
      const tooltip = wrapper.get('[data-dashboard-tooltip]').element.getBoundingClientRect();
      expect(title.height).toBeGreaterThan(60);
      expect(tooltip.top - title.bottom).toBeGreaterThanOrEqual(11);
    } finally { wrapper.unmount(); }
  });

  it('空闲和隐藏时不重绘，扫光不重复发布静止标签，销毁结束定时动画', async () => {
    const element = host();
    const data = await loadDashboardRegions(new AbortController().signal);
    const labels = vi.fn<SceneCallbacks['onLabels']>();
    const rendered = vi.spyOn(WebGL2RenderingContext.prototype, 'clear');
    const scene = new JiangsuMapScene(element, data.regions, {
      onLabels: labels, onHover: () => {}, onCityClick: () => {}, onCityPointer: () => {}, onFailure: () => {}
    });
    try {
      await scene.playEntrance(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const renders = rendered.mock.calls.length;
      const publications = labels.mock.calls.length;
      // 取样窗口确认无操作时没有引擎重绘，而非等待某个异步事件
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(rendered.mock.calls.length).toBe(renders);
      scene.updateValues(Object.fromEntries(data.regions.map(region => [region.code, 80])), .1);
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
    } finally { scene.dispose(); vi.restoreAllMocks(); }
    expect(element.querySelectorAll('canvas')).toHaveLength(0);
  }, 10000);

  it('截图同步拟合新尺寸，释放后画布移除并结束未完成入场', async () => {
    const element = host();
    const data = await loadDashboardRegions(new AbortController().signal);
    const labels = vi.fn<SceneCallbacks['onLabels']>();
    const scene = new JiangsuMapScene(element, data.regions, {
      onLabels: labels, onHover: () => {}, onCityClick: () => {}, onCityPointer: () => {}, onFailure: () => {}
    });
    try {
      await scene.playEntrance(true);
      scene.updateValues(Object.fromEntries(data.regions.map(region => [region.code, 50])));
      element.style.width = '600px';
      const canvas = scene.capture();
      expect(canvas.width).toBe(1200);
      expect(canvas.height).toBe(1400);
      expect(labels.mock.lastCall?.[0]).toHaveLength(13);
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      const pending = scene.playEntrance();
      scene.dispose();
      await pending;
      expect(element.querySelector('canvas')).toBeNull();
    } finally { scene.dispose(); }
  }, 15000);

  it('运行中失去 WebGL 自动降为二维，重复进入退出不遗留画布', async () => {
    const element = host();
    for (let index = 0; index < 3; index++) {
      const model = useDashboard(createMockData(2026));
      const wrapper = mount(DashboardMap, { attachTo: element, props: { model, reducedMotion: true }, attrs: { style: 'width:900px;height:700px' } });
      try {
        // oxlint-disable-next-line no-await-in-loop -- 连续创建和释放同一容器，验证上一轮资源已清理
        await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'), { timeout: 10000 });
        // 装饰圆环超出容器不能使聚焦操作滚走地图标题
        const mapElement = wrapper.element as HTMLElement;
        mapElement.scrollTop = 100;
        expect(mapElement.scrollTop).toBe(0);
        const canvas = wrapper.get('canvas').element as HTMLCanvasElement;
        const context = canvas.getContext('webgl2');
        expect(context).not.toBeNull();
        const extension = context!.getExtension('WEBGL_lose_context');
        expect(extension).not.toBeNull();
        extension!.loseContext();
        // oxlint-disable-next-line no-await-in-loop -- 本轮降级完成后才能验证释放及下一轮
        await vi.waitFor(() => expect(wrapper.text()).toContain('地图采用简化显示'));
        expect(wrapper.findAll('canvas')).toHaveLength(1);
        expect(wrapper.find('[aria-label="消防救援5分钟可达覆盖率二维分布图"]').exists()).toBe(true);
        model.setYears([]);
        // oxlint-disable-next-line no-await-in-loop -- 卸载前确认本轮筛选收敛
        await vi.waitFor(() => expect(wrapper.text()).toContain('请选择年份'));
      } finally { wrapper.unmount(); }
      expect(element.querySelectorAll('canvas')).toHaveLength(0);
    }
  }, 30000);
});
