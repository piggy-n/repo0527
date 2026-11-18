import { mount, type VueWrapper } from '@vue/test-utils';
import { Ray } from 'three';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { page } from 'vitest/browser';
import { requireIndicator } from '../../city-indicators/catalog';
import { indicatorValue } from '../../city-indicators/indicator-value';
import { required } from '../../testing/required';
import { DASHBOARD_CITIES } from '../cities';
import { createMapClassification } from '../map-classification';
import { DashboardCompass } from './DashboardCompass';
import { DashboardMap } from './DashboardMap';
import { DashboardScaleBar } from './DashboardScaleBar';
import type { MapCornerScope, MapView } from './types';

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach(element => element.remove());
});

function host(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cssText = 'position:relative';
  document.body.append(element);
  hosts.push(element);
  return element;
}

function mapProps() {
  const indicator = requireIndicator('A-15');
  const values = Object.fromEntries(
    DASHBOARD_CITIES.map(city => [city.code, indicatorValue(city.code, indicator, 2026)])
  );
  return {
    indicator,
    title: `2026年江苏省${indicator.name}分布图（${indicator.unit}）`,
    values,
    classification: createMapClassification(Object.values(values)),
    years: [2025, 2026],
    activeYear: 2026,
    reducedMotion: true
  };
}

// 插槽把拿到的朝向、比例和宽度写进 DOM，测试从 DOM 读
const probes = {
  topRight: (view: MapView | null) => <i data-test="north" data-value={view?.northDegrees} />,
  bottomRight: ({ view, maxWidth }: MapCornerScope) => (
    <i data-test="scale" data-value={view?.metersPerPixel} data-max-width={maxWidth} />
  )
};

function reading(wrapper: VueWrapper, name: 'north' | 'scale'): number {
  return Number(wrapper.get(`[data-test="${name}"]`).attributes('data-value'));
}

// 地面的北向在屏幕上的顺时针角（正交投影的近似）：北向在相机右向量和上向量上的分量。
// 透视和让省域居中的视口偏移让实测值比它大不到 1°（静止视角 4.3° 对 4.2°，拖动后 35.9° 对 35.0°）
function northAt(yaw: number, pitch: number): number {
  return Math.atan2(Math.sin(yaw), Math.sin(pitch) * Math.cos(yaw)) * 180 / Math.PI;
}

// 等北向的读数在两次检查之间不再变化（拖动的缓动约 0.22 秒）
async function settledNorth(wrapper: VueWrapper): Promise<number> {
  let previous = Number.NaN;
  await vi.waitFor(() => {
    const current = reading(wrapper, 'north');
    const stable = current === previous;
    previous = current;
    expect(stable).toBe(true);
  }, { interval: 100 });
  return previous;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function loseContext(wrapper: VueWrapper): void {
  const canvas = wrapper.get('canvas').element as HTMLCanvasElement;
  const context = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
  required(context.getExtension('WEBGL_lose_context'), 'WEBGL_lose_context 扩展').loseContext();
}

describe('地图的指北针和比例尺', () => {
  it('三维入场后给出静止视角的北向，拖动改变朝向后跟着转；二维降级时正北朝上，比例照样量得到', async () => {
    const sampled = vi.spyOn(Ray.prototype, 'intersectPlane');
    onTestFinished(() => sampled.mockRestore());
    const wrapper = mount(DashboardMap, {
      attachTo: host(),
      props: mapProps(),
      attrs: { style: 'width:900px;height:700px' },
      slots: probes
    });
    await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'), { timeout: 10000 });
    // 静止视角正北朝上
    const resting = await settledNorth(wrapper);
    expect(Math.abs(resting)).toBeLessThan(0.5);
    expect(sampled).toHaveBeenCalled();
    // 江苏东西约 600 千米，900 × 700 的地图在三维里实测约 705 米每像素
    const metersPerPixel = reading(wrapper, 'scale');
    expect(metersPerPixel).toBeGreaterThan(600);
    expect(metersPerPixel).toBeLessThan(850);
    expect(Number(wrapper.get('[data-test="scale"]').attributes('data-max-width'))).toBeGreaterThan(100);
    // 两个角上的叠加元素都跟图例一起入场
    expect(wrapper.findAll('[data-enter="legend"]')).toHaveLength(3);

    // 向左拖 100 像素，yaw 加 0.4
    const target = wrapper.get('[aria-label$="三维分布图"]').element as HTMLElement;
    const { left, top, width, height } = target.getBoundingClientRect();
    const init = { bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientY: top + height / 2 };
    target.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: left + width / 2 }));
    target.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: left + width / 2 - 100 }));
    target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: left + width / 2 - 100 }));
    await vi.waitFor(() => expect(reading(wrapper, 'north')).toBeGreaterThan(20));
    expect(Math.abs(await settledNorth(wrapper) - northAt(0.4, 0.76))).toBeLessThan(1.5);

    loseContext(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain('地图采用简化显示'));
    await vi.waitFor(() => expect(reading(wrapper, 'north')).toBe(0));
    // 二维降级按 ECharts 的布局缩放，900 × 700 时实测约 1117 米每像素
    const flatMetersPerPixel = reading(wrapper, 'scale');
    expect(flatMetersPerPixel).toBeGreaterThan(1000);
    expect(flatMetersPerPixel).toBeLessThan(1250);
  }, 30000);

  it('一开始就是二维降级时正北朝上，比例照样量得到', async () => {
    const wrapper = mount(DashboardMap, {
      attachTo: host(),
      props: { ...mapProps(), forceFallback: true },
      attrs: { style: 'width:900px;height:700px' },
      slots: probes
    });
    await vi.waitFor(() => expect(reading(wrapper, 'north')).toBe(0), { timeout: 10000 });
    expect(reading(wrapper, 'scale')).toBeGreaterThan(1000);
    expect(reading(wrapper, 'scale')).toBeLessThan(1250);
  }, 15000);

  it('不用角上的插槽时场景不取样，地图外壳不多出元素和样式', async () => {
    const sampled = vi.spyOn(Ray.prototype, 'intersectPlane');
    onTestFinished(() => sampled.mockRestore());
    const wrapper = mount(DashboardMap, {
      attachTo: host(),
      props: mapProps(),
      attrs: { style: 'width:900px;height:700px' }
    });
    await vi.waitFor(() => expect(wrapper.findAll('button[aria-haspopup="dialog"]')).toHaveLength(13), {
      timeout: 10000
    });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(sampled).not.toHaveBeenCalled();
    expect(wrapper.findAll('[data-enter="legend"]')).toHaveLength(1);
    expect(wrapper.attributes('style')).not.toContain('--map-legend-height');
  }, 15000);

  // 地图区的尺寸和界面缩放按外壳的网格算：1920×1080、1366×768、1280×720 下的地图列，以及 ≤720 的单列
  it.each([
    { screen: '1920×1080', viewport: [1280, 800], size: [980, 939], scale: 1, aboveLegend: false },
    { screen: '1366×768', viewport: [1280, 800], size: [682, 641], scale: 0.9, aboveLegend: false },
    { screen: '1280×720', viewport: [1280, 800], size: [608, 593], scale: 0.9, aboveLegend: false },
    { screen: '700 宽', viewport: [700, 1000], size: [676, 600], scale: 0.9, aboveLegend: true }
  ])('$screen：指北针在标题右侧，比例尺在时间轴右侧（窄屏在图例上方），互不重叠', async (
    { viewport, size, scale, aboveLegend }
  ) => {
    await page.viewport(viewport[0], viewport[1]);
    onTestFinished(() => page.viewport(1280, 800));
    const wrapper = mount(DashboardMap, {
      attachTo: host(),
      props: mapProps(),
      attrs: { style: `width:${size[0]}px;height:${size[1]}px;--ui-scale:${scale}` },
      slots: {
        topRight: (view: MapView | null) => <DashboardCompass rotation={view?.northDegrees ?? 0} />,
        bottomRight: ({ view, maxWidth }: MapCornerScope) => (
          view && <DashboardScaleBar metersPerPixel={view.metersPerPixel} maxWidth={maxWidth} />
        )
      }
    });
    await vi.waitFor(() => expect(wrapper.find('[aria-label^="比例尺"]').exists()).toBe(true), { timeout: 10000 });
    const rect = (selector: string) => wrapper.get(selector).element.getBoundingClientRect();
    const map = rect('[aria-label="江苏省当前指标分布地图"]');
    const compass = rect('[aria-label="指北针"]');
    const scaleBar = rect('[aria-label^="比例尺"]');
    const heading = rect('[data-enter="map-title"]');
    const timeline = rect('[aria-label="地图展示年份"]');
    const legend = rect('[aria-label="地图数值分级"]');
    expect(overlaps(compass, heading)).toBe(false);
    expect(compass.left).toBeGreaterThan(heading.right);
    // 和标题行垂直居中对齐，可以比标题行略高（设计稿里也是），不出地图区域
    expect(Math.abs((compass.top + compass.bottom) / 2 - (heading.top + heading.bottom) / 2)).toBeLessThanOrEqual(1);
    expect(compass.top).toBeGreaterThanOrEqual(map.top);
    expect(overlaps(scaleBar, timeline)).toBe(false);
    expect(overlaps(scaleBar, legend)).toBe(false);
    expect(scaleBar.left >= timeline.right).toBe(!aboveLegend);
    expect(scaleBar.bottom <= legend.top).toBe(aboveLegend);
    for (const box of [compass, scaleBar]) {
      expect(box.left).toBeGreaterThanOrEqual(map.left);
      expect(box.right).toBeLessThanOrEqual(map.right);
    }
    // 比例尺连同单位都在量到的空位里
    const corner = required(wrapper.get('[aria-label^="比例尺"]').element.parentElement, '右下角').getBoundingClientRect();
    expect(scaleBar.left).toBeGreaterThanOrEqual(corner.left - 1);
    // 旋转只写在指北针里面的 svg 上
    const svg = wrapper.get('[aria-label="指北针"] svg').element as SVGSVGElement;
    expect(svg.style.transform).toMatch(/^rotate\(/);
    expect((wrapper.get('[aria-label="指北针"]').element as HTMLElement).style.transform).toBe('');
  }, 20000);
});
