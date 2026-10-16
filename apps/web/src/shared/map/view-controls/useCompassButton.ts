import type { MapContext } from '@yzt/map-vue';
import { computed, type ComputedRef } from 'vue';
import { compassRotation, compassTitle } from './compass';
import { VIEW_BUTTON_DURATION } from './zoom';

export interface CompassButton {
  /** 图标要转的角度，交给 SvgIcon 的 rotate */
  readonly rotation: ComputedRef<number>;
  /** 悬停的提示，也是无障碍名称 */
  readonly title: ComputedRef<string>;
  /** 旋转和俯仰回到 0，中心和级别不变 */
  readonly resetNorth: () => void;
}

/**
 * 基础组的指北针（ADR 0058）：点击是一次新的相机操作，只交出 bearing、pitch；不传中心，相机控制不换算避让的留白，
 * 中心和级别都不变。正北、没有俯仰时照常可以点。在组件的 setup 中调用
 */
export function useCompassButton(map: Pick<MapContext, 'useCamera' | 'runCameraOperation'>): CompassButton {
  const camera = map.useCamera();
  return {
    rotation: computed(() => compassRotation(camera.value.bearing)),
    title: computed(() => compassTitle(camera.value)),
    resetNorth: () =>
      map.runCameraOperation(control => control.flyTo({ bearing: 0, pitch: 0 }, { duration: VIEW_BUTTON_DURATION }))
  };
}
