import { computed, defineComponent, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { useDocumentVisibility, useEventListener, useResizeObserver } from '@vueuse/core';
import { CITIES } from '../catalog';
import { createMockData } from '../data/mock-data';
import { useDashboard } from '../composables/useDashboard';
import { useDashboardEntrance } from '../composables/useDashboardEntrance';
import { DashboardFilters } from './DashboardFilters';
import { DashboardCharts, type ChartHover, type DashboardChartsHandle } from './DashboardCharts';
import { DashboardMap } from './DashboardMap';
import { TooltipTable } from './TooltipTable';
import { DashboardAtmosphere } from './DashboardAtmosphere';
import fonts from './DashboardFonts.module.scss';
import styles from './DashboardView.module.scss';

/** 驾驶舱装配只在该 feature 内共享状态，不与现状底图会话耦合 */
export const DashboardView = defineComponent({
  name: 'DashboardView',
  props: { forceFallback: { type: Boolean, default: false }, reducedMotion: { type: Boolean, default: false } },
  setup(props) {
    const model = useDashboard(createMockData(new Date().getFullYear()));
    const shell = ref<HTMLElement>();
    const entrance = useDashboardEntrance(shell, () => props.reducedMotion);
    const charts = ref<DashboardChartsHandle>();
    const density = ref(1);
    const visibility = useDocumentVisibility();
    const tooltip = shallowRef<(ChartHover & { source: string }) | null>(null);
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const tooltipIndicator = computed(() => model.category.value.indicators.find(item => item.id === tooltip.value?.indicatorId));
    const tooltipCity = computed(() => CITIES.find(item => item.code === tooltip.value?.cityCode));
    function keepTooltip(): void { clearTimeout(closeTimer); }
    function clearTooltip(): void { keepTooltip(); tooltip.value = null; }
    function showTooltip(source: string, context: ChartHover | null): void {
      if (context) { keepTooltip(); tooltip.value = { ...context, source }; }
      else if (tooltip.value?.source === source) { keepTooltip(); closeTimer = setTimeout(clearTooltip, 180); }
    }
    watch(model.state, clearTooltip);
    watch(visibility, clearTooltip);
    // 页面尺寸和外层滚动使悬停坐标失效，提示表格内部滚动继续保留
    useEventListener(window, 'resize', clearTooltip);
    useEventListener(window, 'scroll', event => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-dashboard-tooltip]')) { clearTooltip(); }
    }, { capture: true, passive: true });
    useResizeObserver(shell, entries => {
      const size = entries[0]?.contentRect;
      if (size) { density.value = Math.max(.9, Math.min(1.8, size.width / 1920, size.height / 1080)); }
    });
    onScopeDispose(clearTooltip);
    return () => <main ref={shell} class={[fonts.scope, styles.dashboard]} style={{ '--ui-scale': density.value }}
      data-dashboard-phase={entrance.phase.value} aria-busy={entrance.phase.value !== 'ready'}
      data-suspended={visibility.value !== 'visible'} data-reduced={entrance.reduced.value}
      onKeydown={event => { if (event.key === 'Escape') { clearTooltip(); } }}>
      <DashboardAtmosphere entering={entrance.phase.value !== 'ready'} reduced={entrance.reduced.value} />
      <header class={styles.heading} data-enter="title"><h1 data-enter="title-text">江苏省城市国土空间监测城市体检驾驶舱</h1></header>
      <div class={styles.content}>
        <DashboardFilters model={model} active={entrance.phase.value === 'ready'} onLocate={id => charts.value?.locateIndicator(id)} />
        <DashboardMap model={model} forceFallback={props.forceFallback} reducedMotion={entrance.reduced.value}
          active={entrance.phase.value === 'ready'} valuesVisible={entrance.valuesVisible.value} onSettled={() => { void entrance.mapSettled(); }}
          onHover={code => showTooltip('map', code ? { indicatorId: model.indicator.value.id, cityCode: code } : null)}
          onDetail={code => { clearTooltip(); charts.value?.openDetail({ indicatorId: model.indicator.value.id, cityCode: code }); }}>
          {() => tooltip.value && tooltipCity.value && tooltipIndicator.value && <div class={styles.tooltip} data-dashboard-tooltip
            onPointerenter={keepTooltip} onPointerleave={() => showTooltip(tooltip.value?.source ?? '', null)}>
            <TooltipTable indicator={tooltipIndicator.value} city={tooltipCity.value} cities={model.cities.value}
              comparison={model.comparisons.value.get(tooltipIndicator.value.id) ?? []} activeYear={model.state.value.activeYear}
              chartType={model.preference(tooltipIndicator.value).type}
              legend={model.preference(tooltipIndicator.value).legend} />
          </div>}
        </DashboardMap>
        <DashboardCharts ref={charts} model={model} density={density.value} active={entrance.phase.value === 'ready'}
          revealedCount={entrance.revealedCharts.value} reducedMotion={entrance.reduced.value} onHover={context => showTooltip('chart', context)} />
      </div>
    </main>;
  }
});
