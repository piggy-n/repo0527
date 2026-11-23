import 'element-plus/dist/index.css';
import type { LngLat } from '@mx/map-core';
import { mount } from '@vue/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { computed, defineComponent, nextTick, shallowRef } from 'vue';
import { required } from '../../testing/required';
import { MapStatusBar } from '../status-bar/MapStatusBar';
import type { ScaleBar } from '../status-bar/status-bar';
import type { MapReadout, ReadoutPosition } from '../status-bar/useMapReadout';
import { ALL_REQUEST_KINDS, type RequestDisplay, type RequestItem } from './request-status';
import { RequestStatusChip } from './RequestStatusChip';
import type { RequestStatus } from './useRequestStatus';

// 真实的布局（ADR 0040）：条目和状态栏是不是一样高、读数变了条目挪不挪，jsdom 里量不出来（用户 2026-11-22）

// 用到的令牌和页面的正文样式由 app 给出（tokens.scss、fonts.scss、base.scss），这里直接写出；字体文件在不入库的 public/fonts/，
// 没有时回退到别的字体，断言不依赖字体
const TOKENS = {
  '--font-family-base': "'Alibaba PuHuiTi', 'Microsoft YaHei', sans-serif",
  '--font-size-base': '14px',
  '--font-size-xs': '12px',
  '--line-height-tag': '16px',
  '--radius-sm': '4px',
  '--shadow-sm': '0 4px 16px rgba(25, 55, 110, 0.08)',
  '--color-bg-mask': 'rgba(255, 255, 255, 0.96)',
  '--color-text-regular': '#4b5563',
  '--color-text-secondary': '#8a94a6',
  '--color-text-strong': '#2f3a4f',
  '--color-divider': '#e2e5ec',
  '--color-primary': '#597ef7',
  '--color-primary-alpha-12': 'rgba(89, 126, 247, 0.12)',
  '--color-success-text': '#15803d',
  '--color-warning-text': '#b46b00',
  '--color-danger': '#e64b4b'
};
const STYLES = [
  `:root { ${Object.entries(TOKENS).map(([key, value]) => `${key}: ${value};`).join(' ')} }`,
  "@font-face { font-family: 'Alibaba PuHuiTi'; font-weight: 400; src: url('/fonts/AlibabaPuHuiTi-3-55-Regular.woff2'); }",
  // 页面的正文是 14 像素、1.5 倍行高：条目外层是块元素时，行框按它撑高（2026-11-22 的 1 像素）
  'body { margin: 0; font-family: var(--font-family-base); font-size: var(--font-size-base); line-height: 1.5; }'
].join('\n');

const POINT: LngLat = [118.7898, 32.0614];

const item = (extra: Partial<RequestItem>): RequestItem => ({
  key: 'resource:a',
  kind: 'tiles',
  name: '地类图斑',
  icon: 'geometry-polygon',
  requested: 100,
  loaded: 5,
  failed: 0,
  previousFailed: 0,
  detail: null,
  startedAt: 0,
  finishedAt: null,
  ...extra
});
const LOADING = item({});
const FAILED = item({ loaded: 97, failed: 3, finishedAt: 500 });
const DONE = item({ loaded: 100, finishedAt: 500 });

// 和现状底图一样：状态栏占满底边的一行，条目在它的插槽里；读数、请求状态由用例直接改
function setup(width: number) {
  const host = document.body.appendChild(document.createElement('div'));
  host.style.cssText = 'position: fixed; left: 16px; bottom: 16px';
  const scale = shallowRef<ScaleBar | null>({ meters: 10_000, width: 77, label: '10 km' });
  const eye = shallowRef<number | null>(null);
  const position = shallowRef<ReadoutPosition | null>({ lngLat: POINT, center: false });
  const readout: MapReadout = {
    scale: computed(() => scale.value),
    eye: computed(() => eye.value),
    position: computed(() => position.value),
    angles: computed(() => ({ bearing: null, pitch: null })),
    walking: computed(() => null)
  };
  const items = shallowRef<readonly RequestItem[]>([LOADING]);
  const display = shallowRef<RequestDisplay | null>({ settledAt: null });
  const status: RequestStatus = {
    items: computed(() => items.value),
    now: shallowRef(1000),
    display,
    loadingKeys: computed(() => new Set<string>()),
    failedKeys: computed(() => new Set<string>()),
    kinds: computed(() => ALL_REQUEST_KINDS)
  };
  // 宽度定在渲染出来的这一层：mount 在宿主里另套了一层容器
  const Page = defineComponent(() => () => (
    <div style={{ display: 'flex', alignItems: 'flex-end', width: `${width}px` }}>
      <MapStatusBar style={{ flex: '1' }} readout={readout} format="dms" reserve>
        {{ after: () => [<RequestStatusChip status={status} />] }}
      </MapStatusBar>
    </div>
  ));
  const wrapper = mount(Page, { attachTo: host });
  return {
    scale,
    eye,
    position,
    items,
    display,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

// 量尺、插槽的宽度由尺寸监听量出：等它们报到、重排以后的一帧
async function settle() {
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
}

const bar = () =>
  required(document.querySelector('[data-map-status-bar]')?.firstElementChild, '状态栏').getBoundingClientRect();
const chip = () => required(document.querySelector('[data-request-chip]'), '条目').getBoundingClientRect();

// 依次改读数，每次排好以后量条目的左边
async function leftsAfter(steps: readonly (() => void)[]): Promise<number[]> {
  const result: number[] = [];
  for (const step of steps) {
    step();
    // oxlint-disable-next-line no-await-in-loop -- 每次读数变化排好以后再量
    await settle();
    result.push(chip().left);
  }
  return result;
}

let style: HTMLStyleElement | undefined;

beforeAll(async () => {
  style = document.head.appendChild(document.createElement('style'));
  style.textContent = STYLES;
  await document.fonts.load('12px "Alibaba PuHuiTi"').catch(() => []);
});

afterAll(() => {
  style?.remove();
});

afterEach(async () => {
  await page.viewport(1440, 900);
});

// 依次显示加载中、失败、已完成，量条目的上下边和宽度
async function chipStates(ctx: ReturnType<typeof setup>): Promise<{ top: number; bottom: number; width: number }[]> {
  const measured: { top: number; bottom: number; width: number }[] = [];
  for (const items of [[LOADING], [FAILED], [DONE]]) {
    ctx.items.value = items;
    ctx.display.value = items[0] === LOADING ? { settledAt: null } : { settledAt: 500 };
    // oxlint-disable-next-line no-await-in-loop -- 每种状态排好以后再量
    await settle();
    const { top, bottom, width } = chip();
    measured.push({ top, bottom, width });
  }
  return measured;
}

// 现状底图这一行（状态栏加条目）的宽度：1440 宽时很宽，768 宽时约 520
describe.each([
  [1440, 1408],
  [768, 520]
])('请求状态的条目和状态栏（视口 %i）', (viewport, width) => {
  it('三种状态都和状态栏一样高、上下对齐；有最小宽度，短的文字等宽', async () => {
    await page.viewport(viewport, 800);
    using ctx = setup(width);
    const measured = await chipStates(ctx);
    const { top, bottom } = bar();
    expect(bottom - top).toBe(24);
    expect(measured).toStrictEqual(measured.map(() => ({ top, bottom, width: 160 })));
  });

  it('缩放、鼠标移动和进出画布、三维视点高度变了、切换维度，条目都不左右移（状态栏留位）', async () => {
    await page.viewport(viewport, 800);
    using ctx = setup(width);
    const scaleTo = (line: number, label: string) => () => (ctx.scale.value = { meters: 1, width: line, label });
    const center = (value: boolean) => () => (ctx.position.value = { lngLat: POINT, center: value });
    // 经纬度的数字和"°′″."之间有字距调整时，宽度随数字变（2026-11-22 在产物上发现）
    const pointAt = (lngLat: LngLat) => () => (ctx.position.value = { lngLat, center: false });
    const twoD = await leftsAfter([
      scaleTo(32, '5 m'),
      scaleTo(80, '10 m'),
      scaleTo(40, '500 m'),
      center(true),
      scaleTo(64, '1 km'),
      center(false),
      scaleTo(50, '200 km'),
      pointAt([111.1111, 31.1111]),
      pointAt([118.0001, 30.0001]),
      pointAt([121.9876, 34.5432])
    ]);
    expect(new Set(twoD).size).toBe(1);

    const eyeAt = (meters: number) => () => {
      ctx.scale.value = null;
      ctx.eye.value = meters;
    };
    const threeD = await leftsAfter([
      eyeAt(85),
      eyeAt(950),
      center(true),
      eyeAt(9_900),
      eyeAt(12_000),
      center(false),
      eyeAt(420_300),
      eyeAt(4_977_000)
    ]);
    expect(new Set([...twoD, ...threeD]).size).toBe(1);
  });
});

// 375 宽时这一行约 250（右边是底图卡片）：留位的比例尺加上 160 的条目放不下（2026-11-22 在产物上发现比例尺被截掉）
describe('请求状态的条目和状态栏（手机宽度）', () => {
  it('三种状态照样对齐；不留位、条目不撑最小宽度，比例尺不被截掉', async () => {
    await page.viewport(375, 812);
    using ctx = setup(250);
    const measured = await chipStates(ctx);
    const { top, bottom } = bar();
    expect(measured.map(state => [state.top, state.bottom])).toStrictEqual(measured.map(() => [top, bottom]));
    expect(measured.every(state => state.width < 160)).toBe(true);
    const shown = required(document.querySelector('[data-map-status-bar]')?.firstElementChild, '状态栏');
    expect(shown.scrollWidth).toBeLessThanOrEqual(shown.clientWidth);
    const samples = [...shown.querySelectorAll('[aria-hidden="true"]')].filter(element => element.textContent !== '中心');
    expect(samples.map(element => getComputedStyle(element).display)).toStrictEqual(['none', 'none']);
  });
});
