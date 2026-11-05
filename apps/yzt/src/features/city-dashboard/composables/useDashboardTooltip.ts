import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import { CITIES } from '../catalog';
import type { ChartHover } from '../model';
import type { DashboardModel } from './useDashboard';

type TooltipSource = 'map' | 'chart';

/** 统一地图与图表的提示目标，移入提示表格时取消延迟关闭 */
export function useDashboardTooltip(model: DashboardModel, visibility: Ref<DocumentVisibilityState>) {
  const context = shallowRef<(ChartHover & { source: TooltipSource }) | null>(null);
  const indicator = computed(
    () => model.category.value.indicators.find(item => item.id === context.value?.indicatorId)
  );
  const city = computed(() => CITIES.find(item => item.code === context.value?.cityCode));
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

  watch(model.state, close);
  watch(visibility, close);
  // 外层滚动使悬停坐标失效，提示表格内部滚动继续保留
  useEventListener(window, 'resize', close);
  useEventListener(window, 'scroll', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-dashboard-tooltip]')) {
      close();
    }
  }, { capture: true, passive: true });
  onScopeDispose(close);

  return { context, indicator, city, keepOpen, close, show, leave };
}
