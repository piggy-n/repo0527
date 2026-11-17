import { onScopeDispose, shallowRef, watch, type Ref, type WatchSource } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { ChartHover } from '../model';

type TooltipSource = 'map' | 'chart';

interface TooltipOptions {
  /** 筛选等状态变化时关闭提示 */
  reset: WatchSource<unknown>;
  visibility: Ref<DocumentVisibilityState>;
}

/** 统一地图与图表的提示目标，移入提示表格时取消延迟关闭；指标和城市由调用方按目标解析 */
export function useDashboardTooltip({ reset, visibility }: TooltipOptions) {
  const context = shallowRef<(ChartHover & { source: TooltipSource }) | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function keepOpen(): void {
    clearTimeout(closeTimer);
  }

  function close(): void {
    keepOpen();
    context.value = null;
  }

  /** 旧来源的移出事件不能关闭刚由另一个来源打开的提示 */
  function show(source: TooltipSource, target: ChartHover | null): void {
    if (target) {
      keepOpen();
      context.value = { ...target, source };
    } else if (context.value?.source === source) {
      keepOpen();
      closeTimer = setTimeout(close, 180);
    }
  }

  function leave(): void {
    if (context.value) {
      show(context.value.source, null);
    }
  }

  watch(reset, close);
  watch(visibility, close);
  // 外层滚动使悬停坐标失效，提示表格内部滚动继续保留
  useEventListener(window, 'resize', close);
  useEventListener(window, 'scroll', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-dashboard-tooltip]')) {
      close();
    }
  }, { capture: true, passive: true });
  onScopeDispose(close);

  return { context, keepOpen, close, show, leave };
}
