// @vitest-environment node
import type { CameraControl, CameraOperation, MapContext, MapViewState } from '@yzt/map-vue';
import { LatestController } from '@yzt/utils';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { JIANGSU_BOUNDS } from './jiangsu';
import { useDefaultView } from './useDefaultView';

/**
 * useDefaultView 用到的视图状态和相机操作：run 只记下交给它的定位，由测试执行。
 * 等到第一次就绪、首次失败后重试、让给用户的操作、页面卸载时放弃，这些由 run 负责，见 map-vue 的测试和现状底图页的测试
 */
function fakeMap() {
  const operations = new LatestController();
  const runs: { readonly signal: AbortSignal; readonly action: (camera: CameraControl) => void }[] = [];
  const operationOf = (signal: AbortSignal): CameraOperation => ({
    signal,
    run: action => runs.push({ signal, action })
  });
  return {
    viewState: ref<MapViewState>('idle'),
    operations,
    runs,
    currentCameraOperation: () => operationOf(operations.signal),
    runCameraOperation: vi.fn<MapContext['runCameraOperation']>(action => operationOf(operations.next()).run(action))
  };
}

function fakeCamera() {
  const fitBounds = vi.fn<CameraControl['fitBounds']>();
  const camera: CameraControl = { flyTo: vi.fn<CameraControl['flyTo']>(), fitBounds };
  return { camera, fitBounds };
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
  it('初始适配在进入页面时的相机操作下执行，不开始新的操作：不带动画地按江苏的范围平视适配', () => {
    const { map } = setup();
    const { camera, fitBounds } = fakeCamera();
    const [initial] = map.runs;

    expect(map.runs).toHaveLength(1);
    expect(initial?.signal).toBe(map.operations.signal);
    expect(initial?.signal.aborted).toBe(false);
    expect(map.runCameraOperation).not.toHaveBeenCalled();
    initial?.action(camera);

    expect(fitBounds.mock.calls).toStrictEqual([[JIANGSU_BOUNDS, { duration: 0, pitch: 0 }]]);
  });

  it('回到默认视角是一次相机操作：用 500ms 动画按江苏的范围平视适配，不传 padding（自动避开悬浮元素）', () => {
    const { map, defaultView } = setup();
    const { camera, fitBounds } = fakeCamera();
    const [initial] = map.runs;

    defaultView.goToDefaultView();
    const [, located] = map.runs;
    located?.action(camera);

    expect(map.runCameraOperation).toHaveBeenCalledOnce();
    expect(initial?.signal.aborted).toBe(true);
    expect(fitBounds.mock.calls).toStrictEqual([[JIANGSU_BOUNDS, { duration: 500, pitch: 0 }]]);
  });

  it('画布已经创建视图时调用抛错：只能在页面的 setup 里调用一次', () => {
    const map = fakeMap();
    map.viewState.value = 'initializing';

    expect(() => setup(map)).toThrow('useDefaultView 要在画布创建视图之前调用');
    expect(map.runs).toHaveLength(0);
  });

  it('不在组件 setup 或 effectScope 中调用时抛错', () => {
    expect(() => useDefaultView(fakeMap())).toThrow('useDefaultView 只能在组件的 setup 或 effectScope 中调用');
  });
});
