import { computed, nextTick, onScopeDispose, ref, watch, type Ref } from 'vue';
import { useDocumentVisibility, useEventListener, useResizeObserver } from '@vueuse/core';
import { LatestController } from '@yzt/utils';
import { CardWheelGesture, cardStops, nearestStop } from '../charts/card-navigation';

interface CardNavigationOptions {
  ready: () => boolean;
  reduced: () => boolean;
  category: () => string;
}

/** 原生触摸吸附与逐卡翻页共用停靠点；定位只完成最后一次意图 */
export function useCardNavigation(list: Ref<HTMLElement | undefined>, options: CardNavigationOptions) {
  const locatingId = ref<string | null>(null);
  const touchingId = ref<string | null>(null);
  const visibility = useDocumentVisibility();
  const latest = new LatestController();
  const gesture = new CardWheelGesture();
  let frame: number | undefined;
  let targetIndex = 0;
  let animating = false;
  let disposed = false;
  let pendingLocate = false;
  let touching = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const cards = () => [...list.value?.querySelectorAll<HTMLElement>('[data-chart-id]') ?? []];
  const stops = () => {
    const maxScrollTop = Math.max(0, (list.value?.scrollHeight ?? 0) - (list.value?.clientHeight ?? 0));
    return cardStops(cards().map(card => card.offsetTop), maxScrollTop);
  };

  /** 取消当前定位，并按调用方需要恢复浏览器的原生吸附 */
  function cancel(restoreSnap = true): void {
    latest.abort();
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
    animating = false;
    locatingId.value = null;
    pendingLocate = false;
    clearTimeout(settleTimer);
    if (restoreSnap) {
      list.value?.style.removeProperty('scroll-snap-type');
    }
  }

  /** 动画期间暂时关闭原生吸附，结束后固定到目标停靠点 */
  function moveTo(index: number, instant = false, feedback: string | null = null): void {
    cancel(false);
    const element = list.value;
    const positions = stops();
    if (disposed || !element || !positions.length) {
      return;
    }
    const signal = latest.next();
    targetIndex = Math.max(0, Math.min(index, positions.length - 1));
    const target = positions[targetIndex];
    const start = element.scrollTop;
    const duration = instant || options.reduced() || Math.abs(target - start) < 1 ? 0 : 420;
    const started = performance.now();
    locatingId.value = feedback;
    animating = true;
    element.style.scrollSnapType = 'none';
    const advance = (now: number): void => {
      if (signal.aborted) {
        return;
      }
      const progress = duration ? Math.min(1, (now - started) / duration) : 1;
      element.scrollTop = start + (target - start) * (1 - (1 - progress) ** 3);
      if (progress < 1) {
        frame = requestAnimationFrame(advance);
        return;
      }
      frame = undefined;
      animating = false;
      locatingId.value = null;
      element.style.removeProperty('scroll-snap-type');
      element.scrollTo({ top: target, behavior: 'instant' });
    };
    advance(started);
  }

  /** 等分类列表更新后定位，较早的请求不能覆盖后来选择的指标 */
  async function locateIndicator(id: string, { scroll = true }: { scroll?: boolean } = {}): Promise<void> {
    cancel(false);
    gesture.reset();
    const signal = latest.next();
    pendingLocate = true;
    await nextTick();
    if (signal.aborted) {
      return;
    }
    if (!options.ready()) {
      cancel();
      return;
    }
    pendingLocate = false;
    const target = cards().find(card => card.dataset.chartId === id);
    if (target) {
      const maxScrollTop = (list.value?.scrollHeight ?? 0) - (list.value?.clientHeight ?? 0);
      const top = scroll ? Math.min(target.offsetTop, maxScrollTop) : list.value?.scrollTop ?? 0;
      moveTo(nearestStop(stops(), top), false, id);
    } else {
      cancel();
    }
  }

  useEventListener(list, 'wheel', event => {
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!options.ready() || event.ctrlKey || event.metaKey || horizontal || !event.deltaY) {
      return;
    }
    event.preventDefault();
    // 滚轮可能按像素、行或页报告位移，先换算为同一单位
    let factor = 1;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      factor = 16;
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      factor = list.value?.clientHeight ?? 1;
    }
    const direction = gesture.consume(event.deltaY * factor, performance.now());
    if (direction) {
      moveTo((animating ? targetIndex : nearestStop(stops(), list.value?.scrollTop ?? 0)) + direction);
    }
  }, { passive: false });
  useEventListener(list, 'keydown', event => {
    const modified = event.ctrlKey || event.metaKey || event.altKey;
    if (!options.ready() || event.target !== list.value || modified || event.isComposing) {
      return;
    }
    const steps: Readonly<Record<string, number>> = {
      ArrowDown: 1,
      PageDown: 1,
      ArrowUp: -1,
      PageUp: -1,
      ' ': event.shiftKey ? -1 : 1
    };
    const base = animating ? targetIndex : nearestStop(stops(), list.value?.scrollTop ?? 0);
    let next: number | null = null;
    if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = stops().length - 1;
    } else if (steps[event.key]) {
      next = base + steps[event.key];
    }
    if (next === null) {
      return;
    }
    event.preventDefault();
    if (!event.repeat || !animating) {
      moveTo(next);
    }
  });
  useEventListener(list, 'touchstart', event => {
    cancel();
    gesture.reset();
    touching = true;
    // 手指按住的画布不能在滚出可视区时移除，否则浏览器会失去触摸终点和吸附
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-chart-id]') : null;
    touchingId.value = card?.dataset.chartId ?? null;
  }, { passive: true, capture: true });

  function settleNativeScroll(): void {
    clearTimeout(settleTimer);
    if (touching || animating || disposed) {
      return;
    }
    settleTimer = setTimeout(() => {
      if (touching || animating || !options.ready()) {
        return;
      }
      const positions = stops();
      const top = list.value?.scrollTop ?? 0;
      const index = nearestStop(positions, top);
      if (Math.abs((positions[index] ?? 0) - top) > 1) {
        moveTo(index);
      }
    }, 120);
  }

  useEventListener(window, ['touchend', 'touchcancel'], () => {
    touching = false;
    touchingId.value = null;
    settleNativeScroll();
  }, { passive: true, capture: true });
  useEventListener(list, 'scroll', () => {
    if (!animating) {
      targetIndex = nearestStop(stops(), list.value?.scrollTop ?? 0);
      settleNativeScroll();
    }
  }, { passive: true });
  const firstCard = computed(() => {
    options.category();
    return list.value?.querySelector<HTMLElement>('[data-chart-id]');
  });
  useResizeObserver([list, firstCard], () => {
    if (!pendingLocate) {
      moveTo(targetIndex, true);
    }
  });
  watch(
    options.category,
    () => {
      gesture.reset();
      touching = false;
      touchingId.value = null;
      moveTo(0, true);
    },
    { flush: 'post' }
  );
  watch(
    options.ready,
    ready => {
      if (ready) {
        moveTo(0, true);
      }
    },
    { flush: 'post' }
  );
  watch(visibility, () => {
    cancel();
    gesture.reset();
    touching = false;
    touchingId.value = null;
  });
  watch(options.reduced, reduced => {
    if (reduced && animating) {
      moveTo(targetIndex, true);
    }
  });
  onScopeDispose(() => {
    disposed = true;
    cancel();
    latest[Symbol.dispose]();
  });
  return { locateIndicator, locatingId, touchingId };
}
