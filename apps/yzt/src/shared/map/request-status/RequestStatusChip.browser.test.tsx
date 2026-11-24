import 'element-plus/dist/index.css';
import type { LngLat } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { computed, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { required } from '../../testing/required';
import { LayerPanelShell } from '../layer-panel/LayerPanelShell';
import type { ListSplit } from '../layer-panel/panel-split';
import { MapStatusBar } from '../status-bar/MapStatusBar';
import type { ScaleBar, ViewAngles } from '../status-bar/status-bar';
import type { MapReadout, ReadoutPosition } from '../status-bar/useMapReadout';
import { ALL_REQUEST_KINDS, type RequestDisplay, type RequestItem } from './request-status';
import { RequestStatusChip } from './RequestStatusChip';
import type { RequestStatus } from './useRequestStatus';

// 真实的布局（ADR 0040）：状态按钮和状态栏是不是一样高、状态和读数变了谁挪、有没有留出来的空白，jsdom 里量不出来
// （用户 2026-11-22、2026-11-23，ADR 0171）

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
  '--color-bg-container': '#ffffff',
  '--color-text-regular': '#4b5563',
  '--color-text-secondary': '#8a94a6',
  '--color-text-strong': '#2f3a4f',
  '--color-divider': '#e2e5ec',
  '--color-primary': '#597ef7',
  '--color-primary-bg': '#eef3ff',
  '--color-success-text': '#15803d',
  '--color-warning-text': '#b46b00',
  '--color-danger': '#e64b4b'
};
const STYLES = [
  `:root { ${Object.entries(TOKENS).map(([key, value]) => `${key}: ${value};`).join(' ')} }`,
  "@font-face { font-family: 'Alibaba PuHuiTi'; font-weight: 400; src: url('/fonts/AlibabaPuHuiTi-3-55-Regular.woff2'); }",
  // 页面的正文是 14 像素、1.5 倍行高：按钮外层是块元素时，行框按它撑高（2026-11-22 的 1 像素）
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
// 上一轮有失败、这一轮还在加载：转圈角上有红点
const LOADING_WITH_FAILURE = item({ previousFailed: 3 });
const FAILED = item({ loaded: 97, failed: 3, finishedAt: 500 });
const DONE = item({ loaded: 100, finishedAt: 500 });

// 依次显示的四种状态：项、这一次显示
const STATES: readonly (readonly [string, readonly RequestItem[], RequestDisplay | null])[] = [
  ['idle', [], null],
  ['loading', [LOADING], { settledAt: null }],
  ['loading', [LOADING_WITH_FAILURE], { settledAt: null }],
  ['failed', [FAILED], { settledAt: 500 }],
  ['done', [DONE], { settledAt: 500 }]
];

// 和现状底图一样：状态栏占满底边的一行，状态按钮在它前面的插槽里；读数、请求状态由用例直接改
function setup(width: number) {
  const host = document.body.appendChild(document.createElement('div'));
  host.style.cssText = 'position: fixed; left: 16px; bottom: 16px';
  const scale = shallowRef<ScaleBar | null>({ meters: 10_000, width: 77, label: '10 km' });
  const eye = shallowRef<number | null>(null);
  const position = shallowRef<ReadoutPosition | null>({ lngLat: POINT, center: false });
  const angles = shallowRef<ViewAngles>({ bearing: null, pitch: null });
  const readout: MapReadout = {
    scale: computed(() => scale.value),
    eye: computed(() => eye.value),
    position: computed(() => position.value),
    angles: computed(() => angles.value)
  };
  const items = shallowRef<readonly RequestItem[]>([]);
  const display = shallowRef<RequestDisplay | null>(null);
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
      <MapStatusBar style={{ flex: '1' }} readout={readout} format="dms">
        {{ before: () => [<RequestStatusChip status={status} />] }}
      </MapStatusBar>
    </div>
  ));
  const wrapper = mount(Page, { attachTo: host });
  return {
    scale,
    eye,
    position,
    angles,
    items,
    display,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

type Context = ReturnType<typeof setup>;

// 量尺、插槽的宽度由尺寸监听量出：等它们报到、重排以后的一帧
async function settle() {
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
}

const readoutBar = () => required(document.querySelector('[data-map-readout]'), '状态栏');
const chip = () => required(document.querySelector('[data-request-chip]'), '状态按钮').getBoundingClientRect();
// 状态栏里的文字（经纬度在前，ADR 0171）、最后一段
const firstText = () => required(readoutBar().querySelector('[role="img"]'), '经纬度前的图标').getBoundingClientRect();
const lastSegment = () => required(readoutBar().lastElementChild, '最后一段').getBoundingClientRect();
const scaleLeft = () =>
  required(readoutBar().querySelector('[style*="width"]'), '比例尺的线段').getBoundingClientRect().left;

// 依次改读数或状态，每次排好以后量一次
async function measureAfter<T>(steps: readonly (() => void)[], measure: () => T): Promise<T[]> {
  const result: T[] = [];
  for (const step of steps) {
    step();
    // oxlint-disable-next-line no-await-in-loop -- 每次变化排好以后再量
    await settle();
    result.push(measure());
  }
  return result;
}

const showState =
  (ctx: Context, [, items, display]: (typeof STATES)[number]) =>
  () => {
    ctx.items.value = items;
    ctx.display.value = display;
  };

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

// 现状底图这一行的宽度：1440 宽时很宽，768 宽时约 520
describe.each([
  [1440, 1408],
  [768, 520]
])('状态按钮和状态栏（视口 %i）', (viewport, width) => {
  it('空闲、加载中、带红点、失败、完成都和状态栏一样高、上下对齐，宽度不变；状态变了读数不动', async () => {
    await page.viewport(viewport, 800);
    using ctx = setup(width);
    const measured = await measureAfter(
      STATES.map(state => showState(ctx, state)),
      () => {
        const { top, bottom, width: chipWidth, left } = chip();
        return { top, bottom, width: chipWidth, left, readout: readoutBar().getBoundingClientRect().left };
      }
    );
    const { top, bottom } = readoutBar().getBoundingClientRect();
    expect(bottom - top).toBe(24);
    const [first] = measured;
    expect(first).toBeDefined();
    const expected = { ...first, top, bottom };
    expect(measured).toStrictEqual(measured.map(() => expected));
    // 读数紧跟按钮，间距 8
    expect((first?.readout ?? 0) - (first?.left ?? 0) - (first?.width ?? 0)).toBe(8);
    // 宽度只够"转圈 99%"，不再是 160
    expect(first?.width).toBeLessThan(80);
  });

  it('缩放、鼠标移动和进出画布、三维视点高度变了、转动视角：按钮和经纬度都不左右移，比例尺跟在经纬度后面，没有留出来的空白', async () => {
    await page.viewport(viewport, 800);
    using ctx = setup(width);
    const scaleTo = (line: number, label: string) => () => (ctx.scale.value = { meters: 1, width: line, label });
    const center = (value: boolean) => () => (ctx.position.value = { lngLat: POINT, center: value });
    // 经纬度的数字和"°′″."之间有字距调整时，宽度随数字变（2026-11-22 在产物上发现）
    const pointAt = (lngLat: LngLat) => () => (ctx.position.value = { lngLat, center: false });
    const eyeAt = (meters: number) => () => {
      ctx.scale.value = null;
      ctx.eye.value = meters;
    };
    const turn = (bearing: number | null, pitch: number | null) => () => (ctx.angles.value = { bearing, pitch });
    const lefts = await measureAfter(
      [
        scaleTo(32, '5 m'),
        scaleTo(80, '10 m'),
        center(true),
        scaleTo(64, '1 km'),
        center(false),
        scaleTo(50, '200 km'),
        pointAt([118.0001, 30.0001]),
        pointAt([121.9876, 34.5432]),
        turn(-135, null),
        turn(8, 45),
        eyeAt(85),
        center(true),
        eyeAt(12_000),
        eyeAt(4_977_000),
        eyeAt(-18)
      ],
      () => ({ chip: chip().left, icon: firstText().left })
    );
    expect(new Set(lefts.map(({ chip: left }) => left)).size).toBe(1);
    expect(new Set(lefts.map(({ icon }) => icon)).size).toBe(1);

    // 状态栏按内容收紧：最后一段到右边只有内边距
    const right = readoutBar().getBoundingClientRect().right;
    expect(Math.round(right - lastSegment().right)).toBe(8);
  });

  it('鼠标移动、进出画布时比例尺也不动：江苏范围内经纬度的宽度不变（等宽数字、不做字距调整，图标一直在）', async () => {
    await page.viewport(viewport, 800);
    using ctx = setup(width);
    const center = (value: boolean) => () => (ctx.position.value = { lngLat: POINT, center: value });
    const pointAt = (lngLat: LngLat) => () => (ctx.position.value = { lngLat, center: false });
    const lefts = await measureAfter(
      [
        center(true),
        pointAt([116.3611, 30.7511]),
        center(false),
        pointAt([118.0001, 31.1111]),
        pointAt([121.9876, 34.5432]),
        center(true)
      ],
      scaleLeft
    );
    expect(new Set(lefts).size).toBe(1);
  });
});

// 375 宽时这一行约 250（右边是底图卡片）：放不下经纬度，只留按钮和比例尺
describe('状态按钮和状态栏（手机宽度）', () => {
  it('各种状态照样对齐、宽度不变；去掉经纬度，比例尺不被截掉', async () => {
    await page.viewport(375, 812);
    using ctx = setup(250);
    const measured = await measureAfter(
      STATES.map(state => showState(ctx, state)),
      () => {
        const { top, bottom, width } = chip();
        return { top, bottom, width };
      }
    );
    const { top, bottom } = readoutBar().getBoundingClientRect();
    const [first] = measured;
    const expected = { ...first, top, bottom };
    expect(measured).toStrictEqual(measured.map(() => expected));
    const shown = readoutBar();
    expect(shown.textContent).toBe('10 km');
    expect(shown.scrollWidth).toBeLessThanOrEqual(shown.clientWidth);
  });
});

// n 行、每行 32 高的内容
const rows = (n: number) => Array.from({ length: n }, (_, index) => h('div', { key: index, style: { height: '32px' } }));

// 明细和真实的资源图层面板（2026-11-23 审查发现）：面板按内容定高，外壳在自己的尺寸监听里改两段的高度；明细监听面板的尺寸时
// 浏览器同一帧里不再通知比内容浅的面板，报 ResizeObserver loop。用面板发出的两段高度重新放
function setupWithPanel() {
  const host = document.body.appendChild(document.createElement('div'));
  const loopErrors: string[] = [];
  const onError = (event: ErrorEvent) => {
    if (event.message.includes('ResizeObserver')) {
      loopErrors.push(event.message);
    }
  };
  window.addEventListener('error', onError);
  const catalogRows = ref(2);
  const split = shallowRef<ListSplit | null>(null);
  const column = ref<HTMLElement>();
  const status: RequestStatus = {
    items: computed(() => [LOADING]),
    now: shallowRef(1000),
    display: shallowRef({ settledAt: null }),
    loadingKeys: computed(() => new Set<string>()),
    failedKeys: computed(() => new Set<string>()),
    kinds: computed(() => ALL_REQUEST_KINDS)
  };
  const panel = () => {
    const element = column.value?.firstElementChild;
    return element instanceof HTMLElement ? element : null;
  };
  // 同现状底图的左下角：面板一列、下面一行是状态按钮；2 行目录时面板约 344 高，下面放得下明细
  const Page = defineComponent({
    name: 'PanelPage',
    setup() {
      provideMap({ groups: [], camera: { center: POINT, zoom: 7, bearing: 0, pitch: 0 } });
      return () => (
        <div style={{ ...SPACES, display: 'grid', gridTemplateRows: 'minmax(0, 1fr) 24px', gap: '12px', height: '880px' }}>
          <div ref={column} style={{ display: 'flex', flexDirection: 'column', minHeight: '0', width: '320px' }}>
            <LayerPanelShell title="资源图层" ratio={0.4} onLayout={(value: ListSplit | null) => (split.value = value)}>
              {{
                catalogTools: () => [],
                catalogFilter: () => [h('div', { style: { height: '32px' } })],
                catalog: () => rows(catalogRows.value),
                currentTools: () => [],
                current: () => rows(2),
                floating: () => []
              }}
            </LayerPanelShell>
          </div>
          <div style={{ display: 'flex' }}>
            <RequestStatusChip status={status} panel={panel} panelLayout={() => split.value} />
          </div>
        </div>
      );
    }
  });
  const wrapper = mount(Page, { attachTo: host });
  return {
    catalogRows,
    loopErrors,
    panel: () => required(panel(), '面板').getBoundingClientRect(),
    [Symbol.dispose]() {
      window.removeEventListener('error', onError);
      wrapper.unmount();
      host.remove();
    }
  };
}

// 外壳用到的间距令牌
const SPACES = { '--space-xs': '4px', '--space-sm': '8px', '--space-md': '12px', '--space-lg': '16px' };

const popover = () => required(document.querySelector<HTMLElement>('[data-request-popover]'), '明细');

describe('明细和真实的资源图层面板', () => {
  it('明细开着时面板变高：按面板发出的两段高度从下方换到右边，面板到了最大高度时两个底边齐平，不报 ResizeObserver loop（2026-11-23 审查发现，用户 2026-11-24）', async () => {
    await page.viewport(1440, 900);
    using ctx = setupWithPanel();
    await settle();
    required(document.querySelector<HTMLElement>('[data-request-chip]'), '状态按钮').click();
    await settle();
    expect(popover().dataset.requestSide).toBe('below');
    expect(popover().getBoundingClientRect().left).toBeCloseTo(ctx.panel().left, 0);

    // 目录到了：面板撑到列的底部，下面放不下
    ctx.catalogRows.value = 40;
    await settle();
    await settle();
    expect(popover().dataset.requestSide).toBe('beside');
    expect(popover().getBoundingClientRect().left).toBeCloseTo(ctx.panel().right + 8, 0);
    // 面板到了最大高度：两个底边齐平（用户 2026-11-24）
    expect(popover().getBoundingClientRect().bottom).toBeCloseTo(ctx.panel().bottom, 0);
    expect(ctx.loopErrors).toStrictEqual([]);
  });
});
