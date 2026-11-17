import { defineComponent, onScopeDispose, ref, type SlotsType, type VNode } from 'vue';
import { useDocumentVisibility, useResizeObserver } from '@vueuse/core';
import { decodeImages } from '../animation/decode-images';
import pageBackground from '../assets/bg.webp';
import headerSkyline from '../assets/header-skyline.webp';
import mapBackground from '../assets/mapbg.webp';
import { DashboardAtmosphere } from './DashboardAtmosphere';
import fonts from './DashboardFonts.module.scss';
import { useDashboardEntrance, type DashboardEntrance } from './useDashboardEntrance';
import styles from './DashboardShell.module.scss';

/** 默认插槽拿到的入场状态和界面缩放；插槽里放左栏、地图、右栏三块 */
export interface DashboardShellScope {
  readonly entrance: DashboardEntrance;
  readonly density: number;
}

/** 大屏外壳：整屏缩放、背景氛围、标题栏、三栏布局和入场编排；Esc 交给调用方关闭提示 */
export const DashboardShell = defineComponent({
  name: 'DashboardShell',
  props: {
    title: { type: String, required: true },
    /** 减少动画：入场直接到终态 */
    reducedMotion: { type: Boolean, default: false },
    /** 加载耗时的标记名，实测工具按它找 */
    traceName: { type: String, required: true }
  },
  emits: {
    escape: () => true
  },
  slots: Object as SlotsType<{ default?: (scope: DashboardShellScope) => VNode[] }>,
  setup(props, { emit, slots }) {
    const shell = ref<HTMLElement>();
    const entrance = useDashboardEntrance(shell, () => props.reducedMotion, { traceName: props.traceName });
    const density = ref(1);
    const visibility = useDocumentVisibility();
    // 标题和背景在面板入场时才第一次显示，趁地图入场先解码
    const decoding = decodeImages([headerSkyline, pageBackground, mapBackground]);
    onScopeDispose(() => decoding[Symbol.dispose]());

    useResizeObserver(shell, entries => {
      const size = entries[0]?.contentRect;
      if (size) {
        density.value = Math.max(0.9, Math.min(1.8, size.width / 1920, size.height / 1080));
      }
    });

    function onKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        emit('escape');
      }
    }

    return () => (
      <main
        ref={shell}
        class={[fonts.scope, styles.dashboard]}
        style={{ '--ui-scale': density.value }}
        data-dashboard-phase={entrance.phase.value}
        aria-busy={entrance.phase.value !== 'ready'}
        data-suspended={visibility.value !== 'visible'}
        data-reduced={entrance.reduced.value}
        onKeydown={onKeydown}
      >
        <DashboardAtmosphere entering={entrance.phase.value !== 'ready'} reduced={entrance.reduced.value} />
        <header class={styles.heading} data-enter="title">
          <h1 data-enter="title-text">{props.title}</h1>
        </header>
        <div class={styles.content}>{slots.default?.({ entrance, density: density.value })}</div>
      </main>
    );
  }
});
