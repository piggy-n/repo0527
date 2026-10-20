import { useEventListener, useTimeoutFn } from '@vueuse/core';
import { readonly, type Ref, ref, watch } from 'vue';

// 给指针从按钮移到浮层留出时间
const CLOSE_DELAY = 2000;

/** 透明度浮层的关闭规则：离开后延迟关闭，滚动或页面停用时立即关闭 */
export function useLayerOpacityPopup(active: Readonly<Ref<boolean>>) {
  const open = ref(false);
  // 按钮和浮层视为同一个操作区域；拖动滑块时允许指针离开
  let inside = false;
  let pointerId: number | undefined;
  const { start, stop } = useTimeoutFn(() => setOpen(false), CLOSE_DELAY, { immediate: false });

  const setOpen = (visible: boolean) => {
    stop();
    open.value = visible && active.value;
    pointerId = undefined;
  };
  const enter = () => {
    inside = true;
    stop();
  };
  const leave = () => {
    inside = false;
    if (open.value && pointerId === undefined) {
      start();
    }
  };
  const beginPointer = (event: PointerEvent) => {
    if (event.button === 0) {
      pointerId = event.pointerId;
      stop();
    }
  };
  const endPointer = (event: PointerEvent) => {
    if (event.pointerId === pointerId) {
      pointerId = undefined;
      if (!inside) {
        leave();
      }
    }
  };

  // 捕获不冒泡的容器滚动；只在打开期间监听，卸载时由 VueUse 清理
  const eventTarget = () => open.value ? window : null;
  useEventListener(eventTarget, 'scroll', () => setOpen(false), { capture: true, passive: true });
  useEventListener(eventTarget, ['pointerup', 'pointercancel'], endPointer, { capture: true });
  watch(active, visible => {
    if (!visible) {
      setOpen(false);
    }
  }, { flush: 'sync' });

  return { open: readonly(open), setOpen, enter, leave, beginPointer };
}
