// @vitest-environment node
import type { CameraState } from '@yzt/map-core';
import type { CameraControl, MapContext } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import { compassRotation, compassTitle } from './compass';
import { useCompassButton } from './useCompassButton';

const NORTH_UP: CameraState = { center: [119.4, 32.9], zoom: 12.3, bearing: 0, pitch: 0 };

describe('compassTitle', () => {
  it('正北时只写操作；转过时写出取整后的角度，和状态栏一样小角度不写成 358°', () => {
    expect(compassTitle({ bearing: 0, pitch: 0 })).toBe('指北针：恢复正北、垂直俯视');
    expect(compassTitle({ bearing: 35.4, pitch: 20 })).toBe('指北针：恢复正北、垂直俯视（旋转 35°）');
    expect(compassTitle({ bearing: 358, pitch: 0 })).toBe('指北针：恢复正北、垂直俯视（旋转 -2°）');
    // 只俯仰、没有旋转时不写角度：俯仰的角度在状态栏里
    expect(compassTitle({ bearing: 0.3, pitch: 45 })).toBe('指北针：恢复正北、垂直俯视');
  });
});

describe('compassRotation', () => {
  it('地图顺时针转多少，指针逆时针转多少；正北时不转', () => {
    expect(compassRotation(35)).toBe(-35);
    expect(compassRotation(-120)).toBe(120);
    expect(Object.is(compassRotation(0), 0)).toBe(true);
  });
});

// 假的地图上下文：相机由用例改，相机操作立即执行并记下交出的参数
function setup(initial: CameraState) {
  const camera = shallowRef(initial);
  const flyTo = vi.fn<CameraControl['flyTo']>();
  const control: CameraControl = {
    flyTo,
    fitBounds: vi.fn<CameraControl['fitBounds']>(),
    reveal: vi.fn<CameraControl['reveal']>()
  };
  const runCameraOperation = vi.fn<MapContext['runCameraOperation']>(action => action(control));
  const compass = useCompassButton({ useCamera: () => camera, runCameraOperation });
  return { camera, compass, flyTo, runCameraOperation };
}

describe('useCompassButton', () => {
  it('图标的角度和提示跟着相机变', () => {
    const { camera, compass } = setup(NORTH_UP);
    expect([compass.rotation.value, compass.title.value]).toStrictEqual([0, '指北针：恢复正北、垂直俯视']);

    camera.value = { ...NORTH_UP, bearing: 35, pitch: 30 };

    expect([compass.rotation.value, compass.title.value]).toStrictEqual([-35, '指北针：恢复正北、垂直俯视（旋转 35°）']);
  });

  it('点击是一次新的相机操作，只交出旋转和俯仰 0，中心和级别不变；正北时照常执行', () => {
    const { camera, compass, flyTo, runCameraOperation } = setup({ ...NORTH_UP, bearing: -120, pitch: 40 });

    compass.resetNorth();
    camera.value = NORTH_UP;
    compass.resetNorth();

    expect(runCameraOperation).toHaveBeenCalledTimes(2);
    expect(flyTo.mock.calls).toStrictEqual([
      [{ bearing: 0, pitch: 0 }, { duration: 300 }],
      [{ bearing: 0, pitch: 0 }, { duration: 300 }]
    ]);
  });
});
