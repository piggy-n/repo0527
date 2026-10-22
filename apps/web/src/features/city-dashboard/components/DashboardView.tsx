import { defineComponent, ref } from 'vue';
import { useDocumentVisibility, useResizeObserver } from '@vueuse/core';
import { createMockData } from '../data/mock-data';
import { useDashboard } from '../composables/useDashboard';
import { useDashboardEntrance } from '../composables/useDashboardEntrance';
import { useDashboardTooltip } from '../composables/useDashboardTooltip';
import { DashboardFilters } from './DashboardFilters';
import { DashboardCharts, type DashboardChartsHandle } from './DashboardCharts';
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
    const tooltip = useDashboardTooltip(model, visibility);

    useResizeObserver(shell, entries => {
      const size = entries[0]?.contentRect;
      if (size) {
        density.value = Math.max(0.9, Math.min(1.8, size.width / 1920, size.height / 1080));
      }
    });

    /** 地图和侧栏共用详情入口，打开前关闭悬停提示 */
    function openMapDetail(cityCode: string): void {
      tooltip.close();
      charts.value?.openDetail({ indicatorId: model.indicator.value.id, cityCode });
    }

    function hoverMap(cityCode: string | null): void {
      tooltip.show('map', cityCode ? { indicatorId: model.indicator.value.id, cityCode } : null);
    }

    function onKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        tooltip.close();
      }
    }

    function renderTooltip() {
      const { indicator, city } = tooltip;
      if (!tooltip.context.value || !indicator.value || !city.value) {
        return null;
      }
      const preference = model.preference(indicator.value);
      return (
        <div
          class={styles.tooltip}
          data-dashboard-tooltip
          onPointerenter={tooltip.keepOpen}
          onPointerleave={tooltip.leave}
        >
          <TooltipTable
            indicator={indicator.value}
            city={city.value}
            cities={model.cities.value}
            comparison={model.comparisons.value.get(indicator.value.id) ?? []}
            activeYear={model.state.value.activeYear}
            chartType={preference.type}
            legend={preference.legend}
          />
        </div>
      );
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
          <h1 data-enter="title-text">江苏省城市国土空间监测城市体检驾驶舱</h1>
        </header>
        <div class={styles.content}>
          <DashboardFilters
            model={model}
            active={entrance.phase.value === 'ready'}
            onLocate={id => charts.value?.locateIndicator(id)}
          />
          <DashboardMap
            model={model}
            forceFallback={props.forceFallback}
            reducedMotion={entrance.reduced.value}
            active={entrance.phase.value === 'ready'}
            valuesVisible={entrance.valuesVisible.value}
            onSettled={() => void entrance.mapSettled()}
            onHover={hoverMap}
            onDetail={openMapDetail}
          >
            {renderTooltip}
          </DashboardMap>
          <DashboardCharts
            ref={charts}
            model={model}
            density={density.value}
            active={entrance.phase.value === 'ready'}
            revealedCount={entrance.revealedCharts.value}
            reducedMotion={entrance.reduced.value}
            onHover={context => tooltip.show('chart', context)}
          />
        </div>
      </main>
    );
  }
});
