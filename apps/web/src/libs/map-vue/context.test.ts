// @vitest-environment node
import {
  type FitBoundsOptions,
  type MapView,
  MapSession,
  type Unsubscribe,
  type ViewBounds,
  type ViewState
} from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { createApp, ref } from 'vue';
import { INTERNAL_MAP_CONTEXT, MapContextState } from './context';
import { type Box, resolveOverlayOptions } from './overlay';
import { useMapOverlay } from './use-map';

// 卸下之后仍会发事件的视图：MapLibreView 释放时会清空监听，接口本身并不保证这一点
class FakeView implements MapView {
  readonly kind = '2d';
  readonly fitBoundsCalls: (FitBoundsOptions | undefined)[] = [];
  state: ViewState = 'initializing';
  readonly #listeners = new Set<(state: ViewState) => void>();

  whenReady(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  resume(): void {}
  flyTo(): void {}
  fitBounds(_bounds: ViewBounds, options?: FitBoundsOptions): void {
    this.fitBoundsCalls.push(options);
  }

  on(_event: 'statechange', callback: (state: ViewState) => void): Unsubscribe {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  emit(state: ViewState): void {
    this.state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  [Symbol.dispose](): void {}
}

// Node 环境里没有 DOM：只模拟量尺寸用到的两个属性
function fakeElement(rect: Box, isConnected = true): HTMLElement {
  return { isConnected, getBoundingClientRect: () => rect } as unknown as HTMLElement;
}

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height };
}

const CANVAS = fakeElement(box(0, 0, 1440, 620));
const BOUNDS: ViewBounds = [116.3, 30.7, 121.9, 35.2];

function setup() {
  const camera = { center: [119.4, 32.9] as const, zoom: 7, bearing: 0, pitch: 0 };
  const session = new MapSession({ groups: ['basemap'], camera });
  const state = new MapContextState(session, () => undefined, resolveOverlayOptions());
  return {
    state,
    [Symbol.dispose]() {
      state[Symbol.dispose]();
      session[Symbol.dispose]();
    }
  };
}

describe('MapContextState', () => {
  it('卸下视图后，旧视图的事件不再改变视图状态', () => {
    using env = setup();
    const first = new FakeView();
    env.state.attachView(first, CANVAS);
    first.emit('ready');
    expect(env.state.context.viewState.value).toBe('ready');

    env.state.detachView(first);
    first.emit('failed');

    expect(env.state.context.viewState.value).toBe('idle');
    expect(env.state.context.view.value).toBeNull();
  });

  it('卸下的不是当前视图时不做任何事；卸下后可以挂上新的视图', () => {
    using env = setup();
    const first = new FakeView();
    const second = new FakeView();
    env.state.attachView(first, CANVAS);

    env.state.detachView(second);
    expect(env.state.context.view.value).not.toBeNull();

    env.state.detachView(first);
    second.state = 'paused';
    env.state.attachView(second, CANVAS);

    expect(env.state.context.viewState.value).toBe('paused');
  });
});

describe('MapContextState 的定位可视区域', () => {
  it('还没有画布时四边都是边距', () => {
    using env = setup();

    expect(env.state.context.overlayPadding()).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
  });

  it('按登记的元素此刻的位置计算；元素为空、不在文档里时不算，注销后不再算', () => {
    using env = setup();
    env.state.attachView(new FakeView(), CANVAS);
    const panel = ref<HTMLElement | null>(fakeElement(box(16, 16, 320, 588)));
    const detached = ref<HTMLElement>(fakeElement(box(1104, 16, 320, 588), false));
    const empty = ref<HTMLElement>();
    const unregister = env.state.registerOverlay(panel, 'left');
    env.state.registerOverlay(detached, 'right');
    env.state.registerOverlay(empty, 'top');

    expect(env.state.context.overlayPadding()).toEqual({ top: 16, right: 16, bottom: 16, left: 352 });

    // 面板收成窄条：下一次定位时量到的就是窄条
    panel.value = fakeElement(box(16, 16, 40, 588));
    expect(env.state.context.overlayPadding().left).toBe(72);

    unregister();
    expect(env.state.context.overlayPadding().left).toBe(16);
  });

  it('视图入口的 fitBounds 没传 padding 时避开悬浮元素，明确传入（包括 0）时以传入的为准', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    env.state.registerOverlay(ref(fakeElement(box(16, 16, 320, 588))), 'left');
    const viewport = env.state.context.view.value;

    viewport?.fitBounds(BOUNDS, { duration: 0 });
    viewport?.fitBounds(BOUNDS, { padding: 0 });
    viewport?.fitBounds(BOUNDS, { padding: { top: 1, right: 2, bottom: 3, left: 4 } });

    expect(view.fitBoundsCalls).toEqual([
      { duration: 0, padding: { top: 16, right: 16, bottom: 16, left: 352 } },
      { padding: 0 },
      { padding: { top: 1, right: 2, bottom: 3, left: 4 } }
    ]);
  });

  it('useMapOverlay 拿得到上下文、但不在作用域里时抛错，不留下注销不掉的登记', () => {
    using env = setup();
    const app = createApp({});
    app.provide(INTERNAL_MAP_CONTEXT, env.state);

    expect(() => app.runWithContext(() => useMapOverlay(ref<HTMLElement>(), 'left'))).toThrow(
      'useMapOverlay 只能在组件的 setup 或 effectScope 中调用'
    );
  });
});
