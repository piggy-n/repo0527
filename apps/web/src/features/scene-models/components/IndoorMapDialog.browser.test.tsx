import 'element-plus/dist/index.css';
import type { NavPoint } from '@yzt/map-core';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { nextTick } from 'vue';
import { indoorMapOf, type MapPlayer } from '../indoor-map/indoor-map';
import { twoLevelNavigation } from '../indoor-map/indoor-map-testing';
import type { RouteTrack } from '../indoor-map/route-track';
import { IndoorMapDialog } from './IndoorMapDialog';

// 真实的布局和画布（ADR 0040）：取景、双击瞬移、滚轮缩放；每个用例自己的容器，结束时移除

const map = indoorMapOf(twoLevelNavigation());
const player: MapPlayer = { x: 5, y: 6, floor: -5, yaw: 0, hfov: 1.5, target: null };
// 与页面一致的令牌，feature 测试不反向导入 app
const TOKENS = {
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--font-size-xs': '12px',
  '--color-primary': '#597ef7',
  '--color-bg-container': '#ffffff'
};
const mounted: VueWrapper[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount());
  hosts.splice(0).forEach(host => host.remove());
});

// 每帧检查一次，条件成立或超时结束；超时比用例的时限短，画不出来时以断言失败
function frames(check: () => boolean, timeout = 3000): Promise<'ok' | 'timeout'> {
  const start = performance.now();
  return new Promise(resolve => {
    const poll = () => {
      if (check()) {
        resolve('ok');
      } else if (performance.now() - start > timeout) {
        resolve('timeout');
      } else {
        requestAnimationFrame(poll);
      }
    };
    poll();
  });
}

function setup(extra: { readonly route?: RouteTrack | null; readonly teleport?: boolean } = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  hosts.push(host);
  Object.assign(host.style, { position: 'relative', width: '960px', height: '640px' });
  Object.entries(TOKENS).forEach(([name, value]) => host.style.setProperty(name, value));
  const wrapper = mount(IndoorMapDialog, { props: { map, player, ...extra }, attachTo: host });
  mounted.push(wrapper);
  const canvas = wrapper.get('canvas').element;
  const scaleText = () => host.querySelector('[data-scale-bar]')?.textContent ?? '';
  // 比例尺线段的像素长度：同样长的线段，放大后更长
  const barPixels = () => host.querySelector<HTMLElement>('[data-scale-bar] i')?.getBoundingClientRect().width ?? 0;
  return { wrapper, canvas, scaleText, barPixels };
}

// 画布上的像素，比较画路线前后的不同
function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('画布没有 2D 上下文');
  }
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

describe('IndoorMapDialog（真实布局）', () => {
  it('路线漫游（ADR 0097 第 6 节）：这一层上画出路线；双击不瞬移，提示路线漫游时不能瞬移', async () => {
    // 西半边 -5 米的地板上往东走，人在路线北边 4 米
    const route: RouteTrack = {
      points: [
        { x: 2, y: 2, floor: -5, distance: 0 },
        { x: 18, y: 2, floor: -5, distance: 16 }
      ],
      walked: 6
    };
    const { wrapper, canvas, scaleText } = setup({ route, teleport: false });
    await expect(frames(() => scaleText() !== '')).resolves.toBe('ok');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const withRoute = pixels(canvas);
    await wrapper.setProps({ route: null });
    await new Promise(resolve => requestAnimationFrame(resolve));
    const without = pixels(canvas);
    const changed = withRoute.filter((value, index) => value !== without[index]).length;
    expect(changed).toBeGreaterThan(200);

    const box = canvas.getBoundingClientRect();
    await userEvent.dblClick(canvas, { position: { x: box.width / 2, y: box.height / 2 } });
    expect(wrapper.emitted('teleport')).toBeUndefined();
    expect(wrapper.text()).toContain('路线漫游时不能瞬移');
  }, 20000);

  it('量到尺寸后取景：小楼层整层显示；双击画面中间瞬移到这一层能站的地方', async () => {
    const { wrapper, canvas, scaleText } = setup();
    await expect(frames(() => scaleText() !== '')).resolves.toBe('ok');
    expect(canvas.width).toBeGreaterThan(400);

    const box = canvas.getBoundingClientRect();
    await userEvent.dblClick(canvas, { position: { x: box.width / 2, y: box.height / 2 } });

    const [spot] = wrapper.emitted<[NavPoint]>('teleport')?.at(-1) ?? [];
    expect(spot?.floor).toBe(-5);
    expect(spot && spot.x > 0 && spot.x < 19.2).toBe(true);
  }, 20000);

  it('换到 -2F 双击：瞬移到 -2F 的地面；滚轮往后滚缩小，同样长度的比例尺变短', async () => {
    const { wrapper, canvas, scaleText, barPixels } = setup();
    await expect(frames(() => scaleText() !== '')).resolves.toBe('ok');
    const before = { text: scaleText(), pixels: barPixels() };

    await wrapper.findAll('label').at(1)?.trigger('click');
    await nextTick();
    const box = canvas.getBoundingClientRect();
    await userEvent.dblClick(canvas, { position: { x: box.width / 2, y: box.height / 2 } });
    expect(wrapper.emitted<[NavPoint]>('teleport')?.at(-1)?.[0]?.floor).toBe(-10);

    const at = { clientX: box.left + 100, clientY: box.top + 100 };
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, ...at, cancelable: true }));
    await nextTick();
    expect(scaleText()).toBe(before.text);
    expect(barPixels()).toBeLessThan(before.pixels * 0.9);
  }, 20000);
});
