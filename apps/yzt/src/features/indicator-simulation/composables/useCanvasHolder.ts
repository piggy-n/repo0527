import { nextTick, type Ref, ref, watch } from 'vue';

/** 现在谁可以放地图画布：结果地图、范围弹窗；换手的那一轮谁都不放 */
export type CanvasHolder = 'result' | 'scope' | null;

/**
 * 一个地图上下文只能挂一个画布（ADR 0129）：范围弹窗在计算和结果阶段打开时，结果地图要先卸下。
 * 两边的组件更新顺序不确定，所以换手时先让两边都不放，等这一轮更新完再交给新的一边
 */
export function useCanvasHolder(scopeOpen: Readonly<Ref<boolean>>): Readonly<Ref<CanvasHolder>> {
  const holder = ref<CanvasHolder>(scopeOpen.value ? 'scope' : 'result');
  watch(
    scopeOpen,
    async open => {
      holder.value = null;
      await nextTick();
      // 等待期间又开关过：以最新的为准
      if (scopeOpen.value === open) {
        holder.value = open ? 'scope' : 'result';
      }
    },
    { flush: 'sync' }
  );
  return holder;
}
