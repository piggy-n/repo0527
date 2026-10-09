// @vitest-environment node
import { type MapView, MapSession, type Unsubscribe, type ViewState } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { MapContextState } from './context';

// 卸下之后仍会发事件的视图：MapLibreView 释放时会清空监听，接口本身并不保证这一点
class FakeView implements MapView {
  readonly kind = '2d';
  state: ViewState = 'initializing';
  readonly #listeners = new Set<(state: ViewState) => void>();

  whenReady(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  resume(): void {}
  flyTo(): void {}
  fitBounds(): void {}

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

function setup() {
  const session = new MapSession({ groups: ['basemap'], camera: { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 } });
  const state = new MapContextState(session, () => undefined);
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
    env.state.attachView(first);
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
    env.state.attachView(first);

    env.state.detachView(second);
    expect(env.state.context.view.value).not.toBeNull();

    env.state.detachView(first);
    second.state = 'paused';
    env.state.attachView(second);

    expect(env.state.context.viewState.value).toBe('paused');
  });
});
