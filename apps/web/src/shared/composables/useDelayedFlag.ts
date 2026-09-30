import { onScopeDispose, readonly, type Ref, ref, watch, type WatchSource } from 'vue';

export interface DelayedFlagOptions {
  /** 源变为 true 后，持续超过这么久才显示（毫秒） */
  delay?: number;
  /** 一旦显示，至少保持这么久（毫秒） */
  minDuration?: number;
}

/** 延迟显示的开关，用于加载状态：很快结束的操作不显示，显示了就至少保持一段时间，避免一闪而过（见 docs/modules/composables.md） */
export function useDelayedFlag(
  source: WatchSource<boolean>,
  { delay = 300, minDuration = 400 }: DelayedFlagOptions = {}
): Readonly<Ref<boolean>> {
  const shown = ref(false);
  let shownAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  watch(
    source,
    active => {
      clearTimer();
      if (active) {
        // 已经显示时（最短保持期内再次开始）继续显示，不重新计时
        if (!shown.value) {
          timer = setTimeout(() => {
            shown.value = true;
            shownAt = Date.now();
          }, delay);
        }
        return;
      }
      if (!shown.value) {
        return;
      }
      const remaining = shownAt + minDuration - Date.now();
      if (remaining > 0) {
        timer = setTimeout(() => {
          shown.value = false;
        }, remaining);
      } else {
        shown.value = false;
      }
    },
    { immediate: true }
  );

  // 组件卸载时清掉定时器，避免卸载后还修改状态
  onScopeDispose(clearTimer);

  return readonly(shown);
}
