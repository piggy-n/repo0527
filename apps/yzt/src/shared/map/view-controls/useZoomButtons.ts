import type { MapContext } from '@mx/map-vue';
import { computed, type ComputedRef, type MaybeRefOrGetter, shallowRef, toValue } from 'vue';
import {
  canZoom,
  clampZoom,
  levelOf,
  levelTitle,
  type PendingZoom,
  VIEW_BUTTON_DURATION,
  zoomBase,
  type ZoomRange,
  zoomTarget
} from './zoom';

export interface ZoomButtons {
  /** 显示的层级（向下取整） */
  readonly level: ComputedRef<number>;
  /** 悬停时的完整提示 */
  readonly title: ComputedRef<string>;
  readonly canZoomIn: ComputedRef<boolean>;
  readonly canZoomOut: ComputedRef<boolean>;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
}

/**
 * 基础组的层级和放大、缩小（ADR 0053 第 3 节）：每次 ±1，截断在缩放范围里；每次点击是一次新的相机操作，
 * 连续点击时累计目标级别，被别的相机操作作废后从当时的级别重新开始。范围可以随二三维变化（三维的上限更高）。
 * 在组件的 setup 中调用
 */
export function useZoomButtons(
  map: Pick<MapContext, 'useCamera' | 'beginCameraOperation'>,
  range: MaybeRefOrGetter<ZoomRange>
): ZoomButtons {
  const camera = map.useCamera();
  const pending = shallowRef<PendingZoom | null>(null);
  // 范围变了以后，上一次按钮缩放的目标可能在新范围以外（三维放大到 20 级的途中切到二维），从范围以内算起
  const base = () => clampZoom(zoomBase(pending.value, camera.value.zoom), toValue(range));

  const zoom = (step: 1 | -1) => {
    const from = base();
    if (!canZoom(from, step, toValue(range))) {
      return;
    }
    const target = zoomTarget(from, step, toValue(range));
    // 先读出起点再开始新的操作：开始新操作会作废上一次，作废以后就读不到上一次的目标了
    const operation = map.beginCameraOperation();
    const next = { target, signal: operation.signal };
    pending.value = next;
    // 信号的中止不是响应式的：作废时清掉，按钮的可用状态随之按当时的级别重新计算
    operation.signal.addEventListener(
      'abort',
      () => {
        if (pending.value === next) {
          pending.value = null;
        }
      },
      { once: true }
    );
    operation.run(control => control.flyTo({ zoom: target }, { duration: VIEW_BUTTON_DURATION }));
  };

  return {
    level: computed(() => levelOf(camera.value.zoom)),
    title: computed(() => levelTitle(camera.value.zoom)),
    canZoomIn: computed(() => canZoom(base(), 1, toValue(range))),
    canZoomOut: computed(() => canZoom(base(), -1, toValue(range))),
    zoomIn: () => zoom(1),
    zoomOut: () => zoom(-1)
  };
}
