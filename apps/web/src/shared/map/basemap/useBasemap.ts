import type { StyleGroup } from '@yzt/map-core';
import { computed, type ComputedRef, shallowRef } from 'vue';
import { appConfig, type TiandituConfig } from '../../config/app-config';
import {
  type BasemapId,
  type BasemapOption,
  basemapOptions,
  type BasemapState,
  createBasemapStyles,
  initialBasemapState
} from './basemap-style';

export interface UseBasemapOptions {
  /** 默认读取 appConfig.tianditu；测试时传入 */
  readonly tianditu?: TiandituConfig | null;
}

/** 底图的拥有者（ADR 0031）：状态随页面，面板通过 props 拿到它，页面把两个推导函数绑定到分组 */
export interface Basemap {
  /** 可选的底图，按天地图配置得出 */
  readonly options: readonly BasemapOption[];
  readonly selected: ComputedRef<BasemapId>;
  /** 当前底图的透明度（0～1），无底图时为 null */
  readonly opacity: ComputedRef<number | null>;
  /** 选择底图；不可用的底图直接抛错 */
  select(id: BasemapId): void;
  /** 修改当前底图的透明度；不在 0～1 之间、或者无底图时直接抛错 */
  setOpacity(value: number): void;
  /** 绑定到 basemap 分组 */
  deriveGroup(): StyleGroup;
  /** 绑定到 basemap-labels 分组 */
  deriveLabelsGroup(): StyleGroup;
}

/** 创建底图的拥有者，在页面的 setup 中调用；不依赖组件的生命周期 */
export function useBasemap({ tianditu = appConfig.tianditu }: UseBasemapOptions = {}): Basemap {
  const options = basemapOptions(tianditu);
  const styles = createBasemapStyles(tianditu);
  // 状态不可变，变化时整体替换；推导只依赖它
  const state = shallowRef<BasemapState>(initialBasemapState(tianditu));

  const selected = computed(() => state.value.selected);
  const opacity = computed(() => {
    const current = state.value;
    return current.selected === 'none' ? null : current.opacity[current.selected];
  });

  // 不合法的调用是编程错误：界面只提供可用的操作。在操作里抛错，不进入推导和 computed
  const select = (id: BasemapId) => {
    if (!options.some(option => option.id === id)) {
      throw new Error(`底图 ${id} 不可用`);
    }
    if (id !== state.value.selected) {
      state.value = { ...state.value, selected: id };
    }
  };

  const setOpacity = (value: number) => {
    const current = state.value;
    if (current.selected === 'none') {
      throw new Error('无底图时没有透明度');
    }
    if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new RangeError(`底图的透明度应在 0～1 之间，收到 ${value}`);
    }
    // 滑块拖动时会重复给出相同的值，不替换状态就不会重新推导
    if (value !== current.opacity[current.selected]) {
      state.value = { ...current, opacity: { ...current.opacity, [current.selected]: value } };
    }
  };

  return {
    options,
    selected,
    opacity,
    select,
    setOpacity,
    deriveGroup: () => styles.basemapGroup(state.value),
    deriveLabelsGroup: () => styles.labelsGroup(state.value)
  };
}
