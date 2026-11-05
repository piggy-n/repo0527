import {
  type ElementSize,
  type MaybeComputedElementRef,
  type UseElementSizeOptions,
  useElementSize
} from '@vueuse/core';
import { type Ref, readonly, shallowRef, watch } from 'vue';
import { usePageActive } from './usePageActive';

/**
 * 和 useElementSize 一样量元素的尺寸，但所在页面停用（被 KeepAlive 缓存）期间量到的不采用（ADR 0063）：停用时 DOM 移出文档、
 * 量到 0；恢复时 ResizeObserver 要到下一帧才重新量，按 0 排的界面会闪一下。不在 KeepAlive 里时和 useElementSize 相同。
 * 只能在组件的 setup 里调用
 */
export function useShownElementSize(
  target: MaybeComputedElementRef,
  initialSize: ElementSize = { width: 0, height: 0 },
  options?: UseElementSizeOptions
): { readonly width: Readonly<Ref<number>>; readonly height: Readonly<Ref<number>> } {
  const pageActive = usePageActive();
  const measured = useElementSize(target, initialSize, options);
  const width = shallowRef(initialSize.width);
  const height = shallowRef(initialSize.height);
  watch(
    [measured.width, measured.height],
    ([nextWidth, nextHeight]) => {
      if (!pageActive.value) {
        return;
      }
      width.value = nextWidth;
      height.value = nextHeight;
    },
    { immediate: true }
  );
  return { width: readonly(width), height: readonly(height) };
}
