import type { StyleGroup } from '@yzt/map-core';
import { computed, type ComputedRef, shallowRef } from 'vue';
import {
  BOUNDARY_OPTIONS,
  boundaryGroup,
  type BoundaryLevel,
  type BoundaryOption,
  type BoundaryState,
  INITIAL_BOUNDARY_STATE
} from './boundary-style';

/** 行政区边界的拥有者（ADR 0033）：状态随页面，面板通过 props 拿到它，页面把推导函数绑定到 boundaries 分组 */
export interface Boundaries {
  readonly options: readonly BoundaryOption[];
  /** 每一级是否显示 */
  readonly visible: ComputedRef<Readonly<Record<BoundaryLevel, boolean>>>;
  /** 三级共用的透明度（0～1） */
  readonly opacity: ComputedRef<number>;
  readonly setVisible: (level: BoundaryLevel, visible: boolean) => void;
  /** 不在 0～1 之间时直接抛错 */
  readonly setOpacity: (value: number) => void;
  readonly deriveGroup: () => StyleGroup;
}

/** 创建行政区边界的拥有者，在页面的 setup 中调用；进入页面时只显示省界 */
export function useBoundaries(): Boundaries {
  // 状态不可变，变化时整体替换；值没变时不替换，推导不会重新执行
  const state = shallowRef<BoundaryState>(INITIAL_BOUNDARY_STATE);

  const setVisible = (level: BoundaryLevel, visible: boolean) => {
    const current = state.value;
    if (current.visible[level] !== visible) {
      state.value = { ...current, visible: { ...current.visible, [level]: visible } };
    }
  };

  const setOpacity = (value: number) => {
    if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new RangeError(`边界的透明度应在 0～1 之间，收到 ${value}`);
    }
    if (value !== state.value.opacity) {
      state.value = { ...state.value, opacity: value };
    }
  };

  return {
    options: BOUNDARY_OPTIONS,
    visible: computed(() => state.value.visible),
    opacity: computed(() => state.value.opacity),
    setVisible,
    setOpacity,
    deriveGroup: () => boundaryGroup(state.value)
  };
}
