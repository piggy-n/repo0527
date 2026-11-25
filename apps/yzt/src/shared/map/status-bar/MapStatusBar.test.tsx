import { mount } from '@vue/test-utils';
import type { LngLat } from '@mx/map-core';
import { ElTooltip } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, h, nextTick, shallowRef } from 'vue';
import { required } from '../../testing/required';
import type { CoordinateFormat } from '../location/coordinate-format';
import { MapStatusBar } from './MapStatusBar';
import type { ScaleBar, ViewAngles } from './status-bar';
import type { MapReadout, ReadoutPosition } from './useMapReadout';

const SCALE: ScaleBar = { meters: 10000, width: 77, label: '10 km' };
const POINT: LngLat = [118.7898, 32.0614];

function fakeReadout() {
  const scale = shallowRef<ScaleBar | null>(SCALE);
  const position = shallowRef<ReadoutPosition | null>({ lngLat: POINT, center: false });
  const angles = shallowRef<ViewAngles>({ bearing: null, pitch: null });
  const eye = shallowRef<number | null>(null);
  const readout: MapReadout = {
    scale: computed(() => scale.value),
    eye: computed(() => eye.value),
    position: computed(() => position.value),
    angles: computed(() => angles.value)
  };
  return { readout, scale, eye, position, angles };
}

function mountBar(format: CoordinateFormat = 'dms') {
  const fake = fakeReadout();
  const wrapper = mount(MapStatusBar, { props: { readout: fake.readout, format } });
  return { wrapper, ...fake };
}

type Wrapper = ReturnType<typeof mountBar>['wrapper'];

const rootOf = (wrapper: Wrapper) => wrapper.get('[data-map-status-bar]').element;

// 看得见的那一条（量尺里的不算）
const shownBar = (wrapper: Wrapper) => wrapper.find('[data-map-readout]');
const shown = (wrapper: Wrapper) => (shownBar(wrapper).exists() ? shownBar(wrapper).text() : null);
// 读数前图标的读屏名称
const iconHints = (wrapper: Wrapper) => shownBar(wrapper).findAll('[role="img"]').map(icon => icon.attributes('aria-label'));
// 每个悬停提示的说明和它包住的读数（量尺里的不带提示）
const tips = (wrapper: Wrapper) => wrapper.findAllComponents(ElTooltip).map(tip => [tip.props('content'), tip.text()]);
// 接鼠标的读数：只有它们拦截地图的鼠标操作，样式里是 pointer-events: auto
const hoverTargets = (wrapper: Wrapper) => shownBar(wrapper).findAll('[class*="_readout_"]').map(target => target.text());

describe('MapStatusBar', () => {
  // 悬停提示放在 body 下，不归组件管
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('经纬度在前、比例尺在后（ADR 0171），经纬度按坐标定位面板的写法', async () => {
    const { wrapper } = mountBar();

    expect(shown(wrapper)).toBe('118°47′23.28″E, 32°03′41.04″N10 km');
    expect(shownBar(wrapper).find('[style*="width: 77px"]').exists()).toBe(true);

    await wrapper.setProps({ format: 'decimal' });
    expect(shown(wrapper)).toBe('118.789800, 32.06140010 km');
  });

  it('经纬度前一直有图标：鼠标在画布上是指针，不在时是画布中心，含义在说明里；没有"中心"两个字', async () => {
    const { wrapper, position } = mountBar('decimal');
    expect(iconHints(wrapper)).toStrictEqual(['鼠标所在位置的经纬度']);

    position.value = { lngLat: POINT, center: true };
    await nextTick();
    expect(iconHints(wrapper)).toStrictEqual(['画布中心的经纬度']);
    expect(shown(wrapper)).toBe('118.789800, 32.06140010 km');
  });

  it('三维：比例尺换成视点高度的图标和数字，全称在说明里；地表以下换图标（ADR 0080 第 6 节）', async () => {
    const { wrapper, scale, eye } = mountBar('decimal');

    scale.value = null;
    eye.value = 420_300;
    await nextTick();
    expect(shown(wrapper)).toBe('118.789800, 32.061400420 km');
    expect(iconHints(wrapper)).toStrictEqual(['鼠标所在位置的经纬度', '视点高度 420 km']);

    eye.value = -18.4;
    await nextTick();
    expect(shown(wrapper)).toBe('118.789800, 32.06140018 m');
    expect(iconHints(wrapper)).toStrictEqual(['鼠标所在位置的经纬度', '视点在地表以下 18 m']);
  });

  it('旋转、俯仰不为 0 时才有，排在最后，写成图标和角度（用户 2026-11-23）', async () => {
    const { wrapper, angles } = mountBar('decimal');

    angles.value = { bearing: -15, pitch: null };
    await nextTick();
    expect(shown(wrapper)).toBe('118.789800, 32.06140010 km-15°');
    expect(iconHints(wrapper)).toStrictEqual(['鼠标所在位置的经纬度', '旋转 -15°']);

    angles.value = { bearing: -15, pitch: 30 };
    await nextTick();
    expect(shown(wrapper)).toBe('118.789800, 32.06140010 km-15°30°');
    expect(iconHints(wrapper).slice(1)).toStrictEqual(['旋转 -15°', '俯仰 30°']);
  });

  it('每段读数整段（图标和数值）悬停，各出自己的说明：名称和数值（用户 2026-11-24）', async () => {
    const { wrapper, angles, scale, eye } = mountBar('decimal');
    angles.value = { bearing: -15, pitch: 30 };
    await nextTick();
    expect(tips(wrapper)).toStrictEqual([
      ['鼠标所在位置的经纬度', '118.789800, 32.061400'],
      ['比例尺 10 km', '10 km'],
      ['旋转 -15°', '-15°'],
      ['俯仰 30°', '30°']
    ]);
    // 分隔线、旋转和俯仰之间的间隔不接鼠标
    expect(hoverTargets(wrapper)).toStrictEqual(['118.789800, 32.061400', '10 km', '-15°', '30°']);

    scale.value = null;
    eye.value = 420_300;
    angles.value = { bearing: null, pitch: 30 };
    await nextTick();
    expect(tips(wrapper)).toStrictEqual([
      ['鼠标所在位置的经纬度', '118.789800, 32.061400'],
      ['视点高度 420 km', '420 km'],
      ['俯仰 30°', '30°']
    ]);
    expect(hoverTargets(wrapper)).toStrictEqual(['118.789800, 32.061400', '420 km', '30°']);
  });

  it('悬停数值（不在图标上）也出说明，只出这一段的', async () => {
    const { wrapper } = mountBar('decimal');
    const scaleBar = required(shownBar(wrapper).find('[style*="width: 77px"]').element.parentElement, '比例尺这一段');

    scaleBar.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.waitFor(() => expect(document.body.textContent).toContain('比例尺 10 km'));
    expect(document.body.textContent).not.toContain('鼠标所在位置的经纬度');
  });

  it('没有读数（视图不在就绪）时不显示', async () => {
    const { wrapper, scale, position } = mountBar();

    scale.value = null;
    position.value = null;
    await nextTick();

    expect(shown(wrapper)).toBeNull();
  });
});

// jsdom 没有布局，也没有 ResizeObserver：替身按被观察的元素记下回调，用例设定宽度后手动触发
const observed = new Map<Element, (width: number) => void>();

class ResizeObserverStub {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element) {
    observed.set(target, width => {
      const size = [{ inlineSize: width, blockSize: 24 }];
      const entry = { target, contentRect: { width, height: 24 }, contentBoxSize: size, borderBoxSize: size };
      this.#callback([entry as unknown as ResizeObserverEntry], this);
    });
  }

  unobserve() {}

  disconnect() {}
}

// 三把量尺依次是全部、去掉角度、只有比例尺
async function resize(wrapper: Wrapper, available: number, rulers: readonly [number, number, number]) {
  const root = rootOf(wrapper);
  const elements = [root, ...(root.lastElementChild?.children ?? [])];
  for (const [index, width] of [available, ...rulers].entries()) {
    observed.get(required(elements[index], '量尺'))?.(width);
  }
  await nextTick();
}

// 量尺里的文字：按最宽的读数排，缩放、转动时排法不来回切换
const rulerTexts = (wrapper: Wrapper) => [...(rootOf(wrapper).lastElementChild?.children ?? [])].map(ruler => ruler.textContent);

describe('MapStatusBar 放不下时', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    observed.clear();
  });

  it('按根元素的宽度和量尺量出的宽度取舍：先去掉旋转和俯仰，再去掉经纬度', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const { wrapper, angles } = mountBar('decimal');
    angles.value = { bearing: 15, pitch: 30 };
    await nextTick();

    await resize(wrapper, 500, [443, 322, 133]);
    expect(shown(wrapper)).toBe('118.789800, 32.06140010 km15°30°');

    await resize(wrapper, 400, [443, 322, 133]);
    expect(shown(wrapper)).toBe('118.789800, 32.06140010 km');

    await resize(wrapper, 188, [443, 322, 133]);
    expect(shown(wrapper)).toBe('10 km');
  });

  it('量尺按最宽的读数排：比例尺 80 像素的"200 km"，视点高度"8888 km"，有的角度换成 -180°、85°；不带提示', async () => {
    const { wrapper, angles, scale, eye } = mountBar('decimal');
    angles.value = { bearing: 15, pitch: null };
    await nextTick();
    expect(rulerTexts(wrapper)).toStrictEqual([
      '118.789800, 32.061400200 km-180°',
      '118.789800, 32.061400200 km',
      '200 km'
    ]);
    expect(rootOf(wrapper).lastElementChild?.querySelector('[style*="width: 80px"]')).not.toBeNull();

    scale.value = null;
    eye.value = 950;
    angles.value = { bearing: 15, pitch: 40 };
    await nextTick();
    expect(rulerTexts(wrapper)).toStrictEqual([
      '118.789800, 32.0614008888 km-180°85°',
      '118.789800, 32.0614008888 km',
      '8888 km'
    ]);
  });

  it('插槽 before 排在状态栏左边，取舍前先让出它的宽度和 8 像素的间距（ADR 0171）', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const fake = fakeReadout();
    fake.angles.value = { bearing: 15, pitch: 30 };
    const wrapper = mount(MapStatusBar, {
      props: { readout: fake.readout, format: 'decimal' },
      slots: { before: () => [h('button', { type: 'button' }, '请求')] }
    });
    await nextTick();
    const before = rootOf(wrapper).firstElementChild;
    expect(before?.textContent).toBe('请求');
    expect(before?.nextElementSibling?.hasAttribute('data-map-readout')).toBe(true);

    observed.get(required(before, '插槽'))?.(120);
    await resize(wrapper, 500, [443, 322, 133]);
    expect(shown(wrapper)).toBe('118.789800, 32.06140010 km');
  });
});
