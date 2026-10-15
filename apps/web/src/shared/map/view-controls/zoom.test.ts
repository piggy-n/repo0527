// @vitest-environment node
import type { CameraState } from '@yzt/map-core';
import type { CameraControl, CameraOperation } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import { useZoomButtons } from './useZoomButtons';
import { canZoom, levelOf, levelTitle, zoomBase, zoomTarget } from './zoom';

const RANGE = { minZoom: 5, maxZoom: 18 };

describe('层级与缩放的纯函数', () => {
  it('层级向下取整，浮点误差不让 7.9999999 显示成 7', () => {
    expect(levelOf(13.6)).toBe(13);
    expect(levelOf(14)).toBe(14);
    expect(levelOf(7.9999999)).toBe(8);
    expect(levelTitle(13.64)).toBe('当前层级 13（13.6）');
  });

  it('目标级别固定 ±1，截断在缩放范围里；到了边界不能再往这个方向缩放', () => {
    expect(zoomTarget(13.6, 1, RANGE)).toBe(14.6);
    expect(zoomTarget(13.6, -1, RANGE)).toBe(12.6);
    expect(zoomTarget(17.5, 1, RANGE)).toBe(18);
    expect(zoomTarget(5.4, -1, RANGE)).toBe(5);
    expect(canZoom(17.5, 1, RANGE)).toBe(true);
    expect(canZoom(18, 1, RANGE)).toBe(false);
    expect(canZoom(5, -1, RANGE)).toBe(false);
    expect(canZoom(5, 1, RANGE)).toBe(true);
  });

  it('上一次按钮缩放还有效时从它的目标算起，作废以后从相机的级别算起', () => {
    const controller = new AbortController();
    const pending = { target: 15.6, signal: controller.signal };

    expect(zoomBase(pending, 14.2)).toBe(15.6);
    expect(zoomBase(null, 14.2)).toBe(14.2);
    controller.abort();
    expect(zoomBase(pending, 14.2)).toBe(14.2);
  });
});

/** 假的地图上下文：相机由用例改；每次开始操作作废上一次，run 立即执行；interrupt 模拟滚轮等别的相机操作 */
function fakeMap(zoom: number) {
  const camera = shallowRef<CameraState>({ center: [119, 32], zoom, bearing: 0, pitch: 0 });
  let current = new AbortController();
  const flyTo = vi.fn<CameraControl['flyTo']>();
  const control: CameraControl = { flyTo, fitBounds: vi.fn<CameraControl['fitBounds']>() };
  const next = () => {
    current.abort();
    current = new AbortController();
    return current.signal;
  };
  const beginCameraOperation = (): CameraOperation => {
    const signal = next();
    return { signal, run: action => action(control) };
  };
  return { camera, flyTo, map: { useCamera: () => camera, beginCameraOperation }, interrupt: () => void next() };
}

const zooms = (flyTo: ReturnType<typeof fakeMap>['flyTo']) => flyTo.mock.calls.map(([target]) => target.zoom);

describe('useZoomButtons', () => {
  it('显示向下取整的层级；放大、缩小每次 ±1，带 300 ms 的动画', () => {
    const { map, flyTo } = fakeMap(13.6);
    const zoom = useZoomButtons(map, RANGE);

    expect(zoom.level.value).toBe(13);
    zoom.zoomIn();
    expect(flyTo).toHaveBeenLastCalledWith({ zoom: 14.6 }, { duration: 300 });
  });

  it('连续点击累计目标级别，不读动画的中间值', () => {
    const { map, flyTo, camera } = fakeMap(13.6);
    const zoom = useZoomButtons(map, RANGE);

    zoom.zoomIn();
    camera.value = { ...camera.value, zoom: 13.9 };
    zoom.zoomIn();
    zoom.zoomOut();

    expect(zooms(flyTo)).toStrictEqual([14.6, 15.6, 14.6]);
  });

  it('被别的相机操作作废以后，从当时的级别重新开始', () => {
    const { map, flyTo, camera, interrupt } = fakeMap(13.6);
    const zoom = useZoomButtons(map, RANGE);

    zoom.zoomIn();
    interrupt();
    camera.value = { ...camera.value, zoom: 14.1 };
    zoom.zoomIn();

    expect(zooms(flyTo)).toStrictEqual([14.6, 15.1]);
  });

  it('截断在缩放范围里，到头时不可用、点了不缩放；被作废后按当时的级别恢复可用', () => {
    const { map, flyTo, interrupt } = fakeMap(17.5);
    const zoom = useZoomButtons(map, RANGE);
    expect(zoom.canZoomIn.value).toBe(true);

    zoom.zoomIn();
    expect(zooms(flyTo)).toStrictEqual([18]);
    expect(zoom.canZoomIn.value).toBe(false);
    zoom.zoomIn();
    expect(flyTo).toHaveBeenCalledOnce();

    // 相机还停在 17.5（动画被打断），按钮马上恢复可用
    interrupt();
    expect(zoom.canZoomIn.value).toBe(true);
  });

  it('最小级别时缩小不可用', () => {
    const { map } = fakeMap(5);
    const zoom = useZoomButtons(map, RANGE);

    expect(zoom.canZoomOut.value).toBe(false);
    expect(zoom.canZoomIn.value).toBe(true);
  });
});
