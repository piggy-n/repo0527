import { computed, nextTick, onScopeDispose, ref, watch, type Ref } from 'vue';
import { usePreferredReducedMotion } from '@vueuse/core';
import { gsap } from 'gsap';
import { LoadTrace } from '@/shared/perf/load-trace';
import { playVisibleTimeline } from '../animation/timeline-clock';

/** 页面统一编排入场，地图失败也放开侧栏；减少动画直接收敛到终态 */
export function useDashboardEntrance(shell: Ref<HTMLElement | undefined>, reduce: () => boolean) {
  const phase = ref<'map-entering' | 'panels-entering' | 'ready'>('map-entering');
  const valuesVisible = ref(false);
  const revealedCharts = ref(0);
  const preferred = usePreferredReducedMotion();
  const reduced = computed(() => reduce() || preferred.value === 'reduce');
  const trace = new LoadTrace('city-dashboard', ['map', 'ready']);
  trace.begin();
  let context: gsap.Context | undefined;
  let timeline: gsap.core.Timeline | undefined;
  let clock: Disposable | undefined;
  let started = false;
  let disposed = false;

  function finish(): void {
    if (disposed) {
      return;
    }
    valuesVisible.value = true;
    revealedCharts.value = Infinity;
    clock?.[Symbol.dispose]();
    context?.revert();
    context = undefined;
    phase.value = 'ready';
    trace.mark('ready');
  }

  async function mapSettled(): Promise<void> {
    if (started || disposed) {
      return;
    }
    started = true;
    trace.mark('map');
    if (reduced.value) {
      finish();
      return;
    }
    await nextTick();
    if (disposed || !shell.value) {
      return;
    }
    if (reduced.value) {
      finish();
      return;
    }
    phase.value = 'panels-entering';
    context = gsap.context(() => {
      timeline = gsap.timeline({ paused: true, onComplete: finish });
      timeline.fromTo(
        '[data-enter="title"]', { yPercent: -85, autoAlpha: 0, clipPath: 'inset(0 35%)' },
        { yPercent: 0, autoAlpha: 1, clipPath: 'inset(0 0%)', duration: .72, ease: 'power3.out' }, 0
      );
      timeline.fromTo(
        '[data-enter="title-text"]', { y: 18, autoAlpha: 0, clipPath: 'inset(0 50%)' },
        { y: 0, autoAlpha: 1, clipPath: 'inset(0 0%)', duration: .68, ease: 'power2.out' }, .12
      );
      timeline.fromTo('[data-enter="title"]', { '--title-rule': 0 }, { '--title-rule': 1, duration: .8 }, .12);
      timeline.fromTo(
        '[data-enter="map-title"]',
        { y: -16, scaleX: .85, autoAlpha: 0 },
        { y: 0, scaleX: 1, autoAlpha: 1, duration: .6, ease: 'power2.out' },
        .2
      );
      timeline.fromTo(
        '[data-enter="left"]',
        { xPercent: -105, autoAlpha: 0 },
        { xPercent: 0, autoAlpha: 1, duration: .85, ease: 'power3.out' },
        .38
      );
      timeline.fromTo(
        '[data-filter-group]',
        { x: -24, y: 10, autoAlpha: 0 },
        { x: 0, y: 0, autoAlpha: 1, duration: .5, stagger: .1, ease: 'power2.out' },
        .57
      );
      // 只编排首屏卡片，长分类不会把整个入场延长几十秒
      const list = shell.value!.querySelector<HTMLElement>('[data-card-list]');
      const cards = [...list?.querySelectorAll<HTMLElement>('[data-enter="chart"]') ?? []]
        .filter(card => card.offsetTop < (list?.clientHeight ?? 0));
      cards.forEach((card, index) => {
        const start = .48 + index * .12;
        timeline!.fromTo(
          card,
          { xPercent: 105, autoAlpha: 0 },
          { xPercent: 0, autoAlpha: 1, duration: .85, ease: 'power3.out' },
          start
        );
        timeline!.call(() => {
          revealedCharts.value = index + 1;
        }, [], start + .27);
      });
      timeline.fromTo(
        '[data-enter="legend"], [data-enter="timeline"]', { y: 28, scale: .94, autoAlpha: 0 },
        { y: 0, scale: 1, autoAlpha: 1, duration: .65, stagger: .1, ease: 'power2.out' }, .62
      );
      const frameAt = timeline.duration() + .12;
      timeline.call(() => {
        valuesVisible.value = true;
      }, [], 1.1);
      timeline.fromTo(
        '[data-scene="surface"], [data-scene="wash"]',
        { autoAlpha: 0, scale: 1.025 },
        { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'sine.inOut' },
        .38
      );
      const honeycomb = shell.value!.querySelector('[data-scene="honeycomb"]');
      if (honeycomb) {
        timeline.to(honeycomb, { autoAlpha: 0, duration: 1.1, ease: 'sine.inOut' }, .38);
      }
      timeline.fromTo('[data-scene="grid"]', { autoAlpha: 0 }, { autoAlpha: .12, duration: 1.1 }, .38);
      timeline.fromTo('[data-scene="haze"]', { autoAlpha: 0 }, { autoAlpha: .75, duration: 1.1 }, .38);
      timeline.fromTo('[data-scene="particles"]', { autoAlpha: 0 }, { autoAlpha: .65, duration: 1 }, .58);
      timeline.fromTo('[data-scene="mist"]', { autoAlpha: 0 }, { autoAlpha: .6, duration: 1.1 }, .53);
      timeline.fromTo(
        '[data-scene="orbit"]',
        { autoAlpha: 0, scale: .92 },
        { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'power2.out' },
        .48
      );
      timeline.fromTo(
        '[data-scene="frame"]',
        { '--frame-progress': 0 },
        { '--frame-progress': 1, duration: 1.25, ease: 'sine.inOut' },
        frameAt
      );
      clock = playVisibleTimeline(timeline);
    }, shell.value);
  }

  watch(reduced, value => {
    if (value && started) {
      finish();
    }
  });
  onScopeDispose(() => {
    disposed = true;
    clock?.[Symbol.dispose]();
    context?.revert();
  });
  return { phase, reduced, valuesVisible, revealedCharts, mapSettled };
}
