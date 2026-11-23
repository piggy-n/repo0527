import { mount, type VueWrapper } from '@vue/test-utils';
import { Ray } from 'three';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { page } from 'vitest/browser';
import { defineComponent } from 'vue';
import { requireIndicator } from '../../city-indicators/catalog';
import { indicatorValue } from '../../city-indicators/indicator-value';
import { required } from '../../testing/required';
import { DASHBOARD_CITIES } from '../cities';
import { createMapClassification } from '../map-classification';
import { mapLegendLevels } from './config';
import { DashboardCompass } from './DashboardCompass';
import { DashboardMap } from './DashboardMap';
import { DashboardScaleBar } from './DashboardScaleBar';
import { useExportPart } from './export-parts';
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
// 透视和让省域居中的视口偏移让实测值比它大不到 1°（拖动后 32.4° 对 31.5°）；静止视角 yaw 为 0，实测正好是 0°
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

// 指北针 svg 行内样式里的旋转角；角度为 0 时 SvgIcon 不写 transform
function rotation(svg: SVGSVGElement): number {
  return Number(/rotate\((.+)deg\)/.exec(svg.style.transform)?.[1] ?? 0);
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// 拦下保存：拿到交给浏览器下载的图片，不真的下载；导出失败时地图上出现错误提示，带着它的文字失败，15 秒没结束也失败
function interceptDownload(root: Element): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      resolve(blob as Blob);
      return 'blob:map-export';
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const observer = new MutationObserver(() => {
      const alert = root.querySelector('[role="alert"]');
      if (alert) {
        reject(new Error(`导出失败：${alert.textContent ?? ''}`));
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(() => reject(new Error('导出没有结束')), 15000);
    onTestFinished(() => {
      created.mockRestore();
      click.mockRestore();
      observer.disconnect();
      clearTimeout(timer);
    });
  });
}

async function imagePixels(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = required(canvas.getContext('2d'), '2D 上下文');
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

// 区域（图片像素）里有没有和 color 每个通道相差不超过 tolerance 的像素
function hasColor(
  image: ImageData,
  area: { x: number; y: number; width: number; height: number },
  color: string,
  tolerance = 1
): boolean {
  const target = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const offset = (y * image.width + x) * 4;
      if (target.every((value, channel) => Math.abs(image.data[offset + channel] - value) <= tolerance)) {
        return true;
      }
    }
  }
  return false;
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
    // 入场停下后指北针不转：静止视角正北朝上（旋转只写在 svg 上，见 DashboardCompass.test.tsx）
    await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'));
    const svg = wrapper.get('[aria-label="指北针"] svg').element as SVGSVGElement;
    await vi.waitFor(() => expect(Math.abs(rotation(svg))).toBeLessThan(0.5));
    expect((wrapper.get('[aria-label="指北针"]').element as HTMLElement).style.transform).toBe('');
  }, 20000);

  it('下载的图片带图例、指北针和比例尺，比例按截图那一刻的地图尺寸算', async () => {
    // 和比例尺一起放在右下角，记录导出时取到的比例，不画进图片
    const captured: number[] = [];
    const ScaleProbe = defineComponent({
      props: { metersPerPixel: { type: Number, required: true } },
      setup(props) {
        useExportPart(() => {
          captured.push(props.metersPerPixel);
          return null;
        });
        return () => <i data-test="scale" data-value={props.metersPerPixel} />;
      }
    });
    const props = mapProps();
    const wrapper = mount(DashboardMap, {
      attachTo: host(),
      props,
      attrs: { style: 'width:900px;height:700px' },
      slots: {
        topRight: (view: MapView | null) => <DashboardCompass rotation={view?.northDegrees ?? 0} />,
        bottomRight: ({ view, maxWidth }: MapCornerScope) => view
          ? [
            <DashboardScaleBar metersPerPixel={view.metersPerPixel} maxWidth={maxWidth} />,
            <ScaleProbe metersPerPixel={view.metersPerPixel} />
          ]
          : []
      }
    });
    await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'), { timeout: 10000 });
    await vi.waitFor(() => expect(wrapper.find('[aria-label^="比例尺"]').exists()).toBe(true));
    const before = reading(wrapper, 'scale');

    // 地图变矮后紧接着下载：截图时场景按新尺寸重画，比例变大（相机按高度取景），角上的比例尺这时还没重绘
    const saving = interceptDownload(wrapper.element as HTMLElement);
    (wrapper.element as HTMLElement).style.height = '450px';
    (wrapper.get('[aria-label="下载当前地图"]').element as HTMLButtonElement).click();
    const image = await imagePixels(await saving);
    const after = reading(wrapper, 'scale');
    expect(after / before).toBeGreaterThan(1.2);
    expect(captured).toEqual([after]);

    // 图片宽度是地图宽度的 2 倍；底栏（下面 130 像素）左侧有每一档图例的色块，右侧有比例尺的深蓝
    expect(image.width).toBe(1800);
    const footer = { y: image.height - 260, height: 260 };
    const missing = mapLegendLevels(props.classification, props.indicator)
      .filter(level => !hasColor(image, { x: 0, width: 400, ...footer }, level.color))
      .map(level => level.label);
    expect(missing).toEqual([]);
    expect(hasColor(image, { x: 1800 - 480, width: 480, ...footer }, '#0E4894')).toBe(true);
    // 标题栏右侧有指北针的蓝色指针（缩放后有插值，放宽到 12）
    expect(hasColor(image, { x: 1800 - 160, y: 0, width: 160, height: 132 }, '#1674E8', 12)).toBe(true);
  }, 20000);
});
