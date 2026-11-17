import { computed, defineComponent, onScopeDispose, ref } from 'vue';
import { useDocumentVisibility, useResizeObserver } from '@vueuse/core';
import { decodeImages } from '@/shared/dashboard/animation/decode-images';
import pageBackground from '@/shared/dashboard/assets/bg.webp';
import headerSkyline from '@/shared/dashboard/assets/header-skyline.webp';
import mapBackground from '@/shared/dashboard/assets/mapbg.webp';
import { DashboardMap } from '@/shared/dashboard/map/DashboardMap';
import { DashboardAtmosphere } from '@/shared/dashboard/shell/DashboardAtmosphere';
import fonts from '@/shared/dashboard/shell/DashboardFonts.module.scss';
import { useDashboardEntrance } from '@/shared/dashboard/shell/useDashboardEntrance';
import { TooltipLayer } from '@/shared/dashboard/tooltip/TooltipLayer';
import { useDashboardTooltip } from '@/shared/dashboard/tooltip/useDashboardTooltip';
import { CITIES } from '../catalog';
import { yearColor } from '../charts/colors';
import { createMockData } from '../data/mock-data';
import { useDashboard } from '../composables/useDashboard';
import { DashboardFilters } from './DashboardFilters';
import { DashboardCharts, type DashboardChartsHandle } from './DashboardCharts';
import styles from './DashboardView.module.scss';

/** 驾驶舱装配只在该 feature 内共享状态，不与现状底图会话耦合 */
export const DashboardView = defineComponent({
  name: 'DashboardView',
  props: {
    /** 不创建三维场景，直接用二维地图；测试用 */
    forceFallback: { type: Boolean, default: false },
    /** 减少动画：入场直接到终态 */
    reducedMotion: { type: Boolean, default: false }
  },
  setup(props) {
    const model = useDashboard(createMockData(new Date().getFullYear()));
    const shell = ref<HTMLElement>();
    const entrance = useDashboardEntrance(shell, () => props.reducedMotion);
    const charts = ref<DashboardChartsHandle>();
    const density = ref(1);
    const visibility = useDocumentVisibility();
    const tooltip = useDashboardTooltip({ reset: model.state, visibility });
    const tooltipIndicator = computed(
      () => model.category.value.indicators.find(item => item.id === tooltip.context.value?.indicatorId)
    );
    const tooltipCity = computed(() => CITIES.find(item => item.code === tooltip.context.value?.cityCode));
    const mapTitle = computed(() => {
      const { activeYear } = model.state.value;
      const { name, unit } = model.indicator.value;
      return activeYear === null ? '请选择年份' : `${activeYear}年江苏省${name}分布图（${unit}）`;
    });
    // 标题和背景在面板入场时才第一次显示，趁地图入场先解码
    const decoding = decodeImages([headerSkyline, pageBackground, mapBackground]);
    onScopeDispose(() => decoding[Symbol.dispose]());

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
      const indicator = tooltipIndicator.value;
      const city = tooltipCity.value;
      if (!tooltip.context.value || !indicator || !city) {
        return null;
      }
      return (
        <TooltipLayer
          indicator={indicator}
          color={year => yearColor(year, indicator.id)}
          city={city}
          cities={model.cities.value}
          comparison={model.comparisons.value.get(indicator.id) ?? []}
          activeYear={model.state.value.activeYear}
          legend={model.preference(indicator).legend}
          onKeepOpen={tooltip.keepOpen}
          onLeave={tooltip.leave}
        />
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
          <h1 data-enter="title-text">江苏省城市国土空间监测驾驶舱</h1>
        </header>
        <div class={styles.content}>
          <DashboardFilters
            model={model}
            active={entrance.phase.value === 'ready'}
            onLocate={id => charts.value?.locateIndicator(id)}
          />
          <DashboardMap
            indicator={model.indicator.value}
            title={mapTitle.value}
            values={model.mapValues.value}
            classification={model.classification.value}
            years={model.comparisonYears.value}
            activeYear={model.state.value.activeYear}
            forceFallback={props.forceFallback}
            reducedMotion={entrance.reduced.value}
            active={entrance.phase.value === 'ready'}
            valuesVisible={entrance.valuesVisible.value}
            onSettled={() => void entrance.mapSettled()}
            onHover={hoverMap}
            onDetail={openMapDetail}
            onYear={model.setActiveYear}
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
