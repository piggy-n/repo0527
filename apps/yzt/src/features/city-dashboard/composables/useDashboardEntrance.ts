import { usePreferredReducedMotion } from '@vueuse/core';
import { gsap } from 'gsap';
import { computed, nextTick, onScopeDispose, type Ref, ref, watch } from 'vue';
import { LoadTrace } from '@/shared/perf/load-trace';
import { playVisibleTimeline } from '../animation/timeline-clock';

// 首屏以下的卡片不参与入场：分类很长时整个入场不会拖到几十秒
function firstScreenCards(root: HTMLElement): HTMLElement[] {
  const list = root.querySelector<HTMLElement>('[data-card-list]');
  if (!list) {
    return [];
  }
  const cards = [...list.querySelectorAll<HTMLElement>('[data-enter="chart"]')];
  return cards.filter(card => card.offsetTop < list.clientHeight);
}

/**
 * 页面入场的编排：地图先入场（或失败降级），之后标题、侧栏、卡片和背景按时间线进入；
 * 时间线只在页面可见时推进（playVisibleTimeline）。减少动画时直接到终态
 */
export function useDashboardEntrance(shell: Ref<HTMLElement | undefined>, reduce: () => boolean) {
  const phase = ref<'map-entering' | 'panels-entering' | 'ready'>('map-entering');
  // 地图上的数值先显示为 0，入场到一半再过渡到真实值
  const valuesVisible = ref(false);
  // 已入场的卡片数，卡片入场后才画图表
  const revealedCharts = ref(0);
  const preferred = usePreferredReducedMotion();
  const reduced = computed(() => reduce() || preferred.value === 'reduce');
  const trace = new LoadTrace('city-dashboard', ['map', 'ready']);
  trace.begin();
  let context: gsap.Context | undefined;
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
    // 还原动画写在元素上的内联样式，之后由各自的样式决定外观
    context?.revert();
    context = undefined;
    phase.value = 'ready';
    trace.mark('ready');
  }

  // 时间线的时刻（秒）按旧页面调好的节奏，标题、侧栏、卡片、背景依次错开
  function buildTimeline(root: HTMLElement): gsap.core.Timeline {
    const timeline = gsap.timeline({ paused: true, onComplete: finish });
    timeline.fromTo(
      '[data-enter="title"]',
      { yPercent: -85, autoAlpha: 0, clipPath: 'inset(0 35%)' },
      { yPercent: 0, autoAlpha: 1, clipPath: 'inset(0 0%)', duration: 0.72, ease: 'power3.out' },
      0
    );
    timeline.fromTo(
      '[data-enter="title-text"]',
      { y: 18, autoAlpha: 0, clipPath: 'inset(0 50%)' },
      { y: 0, autoAlpha: 1, clipPath: 'inset(0 0%)', duration: 0.68, ease: 'power2.out' },
      0.12
    );
    timeline.fromTo('[data-enter="title"]', { '--title-rule': 0 }, { '--title-rule': 1, duration: 0.8 }, 0.12);
    timeline.fromTo(
      '[data-enter="map-title"]',
      { y: -16, scaleX: 0.85, autoAlpha: 0 },
      { y: 0, scaleX: 1, autoAlpha: 1, duration: 0.6, ease: 'power2.out' },
      0.2
    );
    timeline.fromTo(
      '[data-enter="left"]',
      { xPercent: -105, autoAlpha: 0 },
      { xPercent: 0, autoAlpha: 1, duration: 0.85, ease: 'power3.out' },
      0.38
    );
    timeline.fromTo(
      '[data-filter-group]',
      { x: -24, y: 10, autoAlpha: 0 },
      { x: 0, y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.1, ease: 'power2.out' },
      0.57
    );
    firstScreenCards(root).forEach((card, index) => {
      const start = 0.48 + index * 0.12;
      timeline.fromTo(
        card,
        { xPercent: 105, autoAlpha: 0 },
        { xPercent: 0, autoAlpha: 1, duration: 0.85, ease: 'power3.out' },
        start
      );
      timeline.call(
        () => {
          revealedCharts.value = index + 1;
        },
        [],
        start + 0.27
      );
    });
    timeline.fromTo(
      '[data-enter="legend"], [data-enter="timeline"]',
      { y: 28, scale: 0.94, autoAlpha: 0 },
      { y: 0, scale: 1, autoAlpha: 1, duration: 0.65, stagger: 0.1, ease: 'power2.out' },
      0.62
    );
    // 外框描边排在前面所有动画之后
    const frameAt = timeline.duration() + 0.12;
    timeline.call(
      () => {
        valuesVisible.value = true;
      },
      [],
      1.1
    );
    timeline.fromTo(
      '[data-scene="surface"], [data-scene="wash"]',
      { autoAlpha: 0, scale: 1.025 },
      { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'sine.inOut' },
      0.38
    );
    const honeycomb = root.querySelector('[data-scene="honeycomb"]');
    if (honeycomb) {
      timeline.to(honeycomb, { autoAlpha: 0, duration: 1.1, ease: 'sine.inOut' }, 0.38);
    }
    timeline.fromTo('[data-scene="grid"]', { autoAlpha: 0 }, { autoAlpha: 0.12, duration: 1.1 }, 0.38);
    timeline.fromTo('[data-scene="haze"]', { autoAlpha: 0 }, { autoAlpha: 0.75, duration: 1.1 }, 0.38);
    timeline.fromTo('[data-scene="particles"]', { autoAlpha: 0 }, { autoAlpha: 0.65, duration: 1 }, 0.58);
    timeline.fromTo('[data-scene="mist"]', { autoAlpha: 0 }, { autoAlpha: 0.6, duration: 1.1 }, 0.53);
    timeline.fromTo(
      '[data-scene="orbit"]',
      { autoAlpha: 0, scale: 0.92 },
      { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'power2.out' },
      0.48
    );
    timeline.fromTo(
      '[data-scene="frame"]',
      { '--frame-progress': 0 },
      { '--frame-progress': 1, duration: 1.25, ease: 'sine.inOut' },
      frameAt
    );
    return timeline;
  }

  /** 地图入场结束（或已降级）时由地图调用，只开始一次 */
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
    // 等侧栏和卡片渲染出来再找入场的元素
    await nextTick();
    const root = shell.value;
    if (disposed || !root) {
      return;
    }
    if (reduced.value) {
      finish();
      return;
    }
    phase.value = 'panels-entering';
    // 选择器限定在页面内；revert 时一并还原
    context = gsap.context(() => {
      clock = playVisibleTimeline(buildTimeline(root));
    }, root);
  }

  // 入场中途切换成减少动画：直接到终态
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
