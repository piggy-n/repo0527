import { mount } from '@vue/test-utils';
import type { LngLat } from '@yzt/map-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, shallowRef } from 'vue';
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
const shown = (wrapper: Wrapper) => rootOf(wrapper).firstElementChild?.textContent ?? null;

describe('MapStatusBar', () => {
  it('比例尺和经纬度，经纬度按坐标定位面板的写法', async () => {
    const { wrapper } = mountBar();

    expect(shown(wrapper)).toBe('10 km118°47′23.28″E, 32°03′41.04″N');
    expect(wrapper.find('[style*="width: 77px"]').exists()).toBe(true);

    await wrapper.setProps({ format: 'decimal' });
    expect(shown(wrapper)).toBe('10 km118.789800, 32.061400');
  });

  it('三维：比例尺换成视点高度，其余照旧（ADR 0080 第 6 节）', async () => {
    const { wrapper, scale, eye } = mountBar('decimal');

    scale.value = null;
    eye.value = 420_300;
    await nextTick();

    expect(shown(wrapper)).toBe('视点高度 420 km118.789800, 32.061400');
  });

  it('鼠标不在画布上时，经纬度前面标"中心"', async () => {
    const { wrapper, position } = mountBar('decimal');

    position.value = { lngLat: POINT, center: true };
    await nextTick();

    expect(shown(wrapper)).toBe('10 km中心118.789800, 32.061400');
  });

  it('旋转、俯仰不为 0 时才显示', async () => {
    const { wrapper, angles } = mountBar('decimal');

    angles.value = { bearing: -15, pitch: null };
    await nextTick();
    expect(shown(wrapper)).toContain('旋转 -15°');
    expect(shown(wrapper)).not.toContain('俯仰');

    angles.value = { bearing: -15, pitch: 30 };
    await nextTick();
    expect(shown(wrapper)).toContain('旋转 -15°俯仰 30°');
  });

  it('没有读数（视图不在就绪）时不显示', async () => {
    const { wrapper, scale, position } = mountBar();

    scale.value = null;
    position.value = null;
    await nextTick();

    expect(wrapper.text()).toBe('');
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
    observed.get(elements[index])?.(width);
  }
  await nextTick();
}

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
    expect(shown(wrapper)).toBe('10 km118.789800, 32.061400旋转 15°俯仰 30°');

    await resize(wrapper, 400, [443, 322, 133]);
    expect(shown(wrapper)).toBe('10 km118.789800, 32.061400');

    await resize(wrapper, 188, [443, 322, 133]);
    expect(shown(wrapper)).toBe('10 km');
  });
});
