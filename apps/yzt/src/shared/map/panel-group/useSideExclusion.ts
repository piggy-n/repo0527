import { useMediaQuery } from '@vueuse/core';
import { COMPACT_MEDIA_QUERY } from '@yzt/ui';
import { computed, type ComputedRef, ref } from 'vue';
import { type MapSide, visibleSides } from './panel-group';

export interface SideExclusion {
  /** 左边的资源面板显示为展开 */
  readonly left: ComputedRef<boolean>;
  /** 右边的面板显示 */
  readonly right: ComputedRef<boolean>;
  /** 用户操作了某一边：点了右边的入口，或展开了资源面板 */
  readonly activate: (side: MapSide) => void;
}

export interface UseSideExclusionOptions {
  /** 资源面板按自己的状态是否展开 */
  readonly leftExpanded: () => boolean;
  /** 右边是否有打开着的面板 */
  readonly rightOpen: () => boolean;
  /** 测试时传入；默认按全应用的窄屏断点 */
  readonly narrow?: () => boolean;
}

/** 窄屏时左右只显示一边（ADR 0053 第 8 节），在页面的 setup 中调用；只推导显示，不改两边各自的状态 */
export function useSideExclusion({ leftExpanded, rightOpen, narrow }: UseSideExclusionOptions): SideExclusion {
  const compact = narrow ? null : useMediaQuery(COMPACT_MEDIA_QUERY);
  const lastSide = ref<MapSide>('right');
  const sides = computed(() =>
    visibleSides({
      narrow: narrow ? narrow() : compact?.value === true,
      leftExpanded: leftExpanded(),
      rightOpen: rightOpen(),
      lastSide: lastSide.value
    })
  );

  return {
    left: computed(() => sides.value.left),
    right: computed(() => sides.value.right),
    activate: side => (lastSide.value = side)
  };
}
