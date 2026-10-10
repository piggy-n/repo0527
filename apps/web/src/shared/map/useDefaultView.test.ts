// @vitest-environment node
import type { MapViewport, MapViewState } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';
import { JIANGSU_BOUNDS } from './jiangsu';
import { useDefaultView } from './useDefaultView';

function fakeViewport() {
  const fitBounds = vi.fn<MapViewport['fitBounds']>();
  const viewport: MapViewport = Object.freeze({ kind: '2d', flyTo: vi.fn<MapViewport['flyTo']>(), fitBounds });
  return { viewport, fitBounds };
}

// 只有 useDefaultView 用到的 view 和 viewState
function fakeMap() {
  return { view: shallowRef<MapViewport | null>(null), viewState: ref<MapViewState>('idle') };
}

function setup(map = fakeMap()) {
  const scope = effectScope();
  const defaultView = scope.run(() => useDefaultView(map));
  if (!defaultView) {
    throw new Error('没有创建默认视角');
  }
  return { map, scope, defaultView };
}

describe('useDefaultView', () => {
  it('第一次就绪时不带动画地按江苏的范围适配一次，之后再就绪不再定位', async () => {
    const { map } = setup();
    const { viewport, fitBounds } = fakeViewport();

    map.view.value = viewport;
    map.viewState.value = 'initializing';
    await nextTick();
    expect(fitBounds).not.toHaveBeenCalled();

    map.viewState.value = 'ready';
    await nextTick();
    expect(fitBounds.mock.calls).toStrictEqual([[JIANGSU_BOUNDS, { duration: 0 }]]);

    map.viewState.value = 'paused';
    await nextTick();
    map.viewState.value = 'ready';
    await nextTick();
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('首次失败、重试后在新视图第一次就绪时补做', async () => {
    const { map } = setup();
    const failed = fakeViewport();
    const retried = fakeViewport();

    map.view.value = failed.viewport;
    map.viewState.value = 'failed';
    await nextTick();
    map.view.value = retried.viewport;
    map.viewState.value = 'initializing';
    await nextTick();
    map.viewState.value = 'ready';
    await nextTick();

    expect(failed.fitBounds).not.toHaveBeenCalled();
    expect(retried.fitBounds.mock.calls).toStrictEqual([[JIANGSU_BOUNDS, { duration: 0 }]]);
  });

  it('回到默认视角：就绪时用 500ms 动画按江苏的范围适配，不传 padding（自动避开悬浮元素）', async () => {
    const { map, defaultView } = setup();
    const { viewport, fitBounds } = fakeViewport();
    map.view.value = viewport;
    map.viewState.value = 'ready';
    await nextTick();
    fitBounds.mockClear();

    defaultView.goToDefaultView();

    expect(fitBounds.mock.calls).toStrictEqual([[JIANGSU_BOUNDS, { duration: 500 }]]);
  });

  it.each(['idle', 'initializing', 'paused', 'failed'] as const)('视图是 %s 时回到默认视角什么也不做', state => {
    const { map, defaultView } = setup();
    const { viewport, fitBounds } = fakeViewport();
    map.view.value = state === 'idle' ? null : viewport;
    map.viewState.value = state;

    expect(() => defaultView.goToDefaultView()).not.toThrow();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('作用域销毁后，视图就绪时不再定位', async () => {
    const { map, scope } = setup();
    const { viewport, fitBounds } = fakeViewport();

    scope.stop();
    map.view.value = viewport;
    map.viewState.value = 'ready';
    await nextTick();

    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('视图已经存在时调用抛错：只能在页面的 setup 里调用一次', () => {
    const map = fakeMap();
    map.view.value = fakeViewport().viewport;
    map.viewState.value = 'ready';

    expect(() => setup(map)).toThrow('useDefaultView 要在画布创建视图之前调用');
  });

  it('不在组件 setup 或 effectScope 中调用时抛错', () => {
    expect(() => useDefaultView(fakeMap())).toThrow('useDefaultView 只能在组件的 setup 或 effectScope 中调用');
  });
});
