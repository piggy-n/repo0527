import { computed, defineComponent, ref } from 'vue';
import { useDocumentVisibility } from '@vueuse/core';
import { withUnit } from '@/shared/dashboard/format';
import { DashboardMap } from '@/shared/dashboard/map/DashboardMap';
import { DashboardShell, type DashboardShellScope } from '@/shared/dashboard/shell/DashboardShell';
import { TooltipLayer } from '@/shared/dashboard/tooltip/TooltipLayer';
import { useDashboardTooltip } from '@/shared/dashboard/tooltip/useDashboardTooltip';
import { CITIES } from '../catalog';
import { yearColor } from '../charts/colors';
import { createMockData } from '../data/mock-data';
import { useDashboard } from '../composables/useDashboard';
import { DashboardFilters } from './DashboardFilters';
import { DashboardCharts, type DashboardChartsHandle } from './DashboardCharts';

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
    const charts = ref<DashboardChartsHandle>();
    const visibility = useDocumentVisibility();
    const tooltip = useDashboardTooltip({ reset: model.state, visibility });
    const tooltipIndicator = computed(
      () => model.category.value.indicators.find(item => item.id === tooltip.context.value?.indicatorId)
    );
    const tooltipCity = computed(() => CITIES.find(item => item.code === tooltip.context.value?.cityCode));
    const mapTitle = computed(() => {
      const { activeYear } = model.state.value;
      const { name, unit } = model.indicator.value;
      return activeYear === null ? '请选择年份' : `${activeYear}年江苏省${withUnit(`${name}分布图`, unit)}`;
    });

    /** 地图和侧栏共用详情入口，打开前关闭悬停提示 */
    function openMapDetail(cityCode: string): void {
      tooltip.close();
      charts.value?.openDetail({ indicatorId: model.indicator.value.id, cityCode });
    }

    function hoverMap(cityCode: string | null): void {
      tooltip.show('map', cityCode ? { indicatorId: model.indicator.value.id, cityCode } : null);
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

    // 三栏：筛选、地图、图表；入场状态和缩放由外壳给出
    function renderPanels({ entrance, density }: DashboardShellScope) {
      const ready = entrance.phase.value === 'ready';
      return [
        <DashboardFilters model={model} active={ready} onLocate={id => charts.value?.locateIndicator(id)} />,
        <DashboardMap
          indicator={model.indicator.value}
          title={mapTitle.value}
          values={model.mapValues.value}
          classification={model.classification.value}
          years={model.comparisonYears.value}
          activeYear={model.state.value.activeYear}
          forceFallback={props.forceFallback}
          reducedMotion={entrance.reduced.value}
          active={ready}
          valuesVisible={entrance.valuesVisible.value}
          onSettled={() => void entrance.mapSettled()}
          onHover={hoverMap}
          onDetail={openMapDetail}
          onYear={model.setActiveYear}
        >
          {renderTooltip}
        </DashboardMap>,
        <DashboardCharts
          ref={charts}
          model={model}
          density={density}
          active={ready}
          revealedCount={entrance.revealedCharts.value}
          reducedMotion={entrance.reduced.value}
          onHover={context => tooltip.show('chart', context)}
        />
      ];
    }

    return () => (
      <DashboardShell
        title="江苏省城市国土空间监测驾驶舱"
        traceName="city-dashboard"
        reducedMotion={props.reducedMotion}
        onEscape={tooltip.close}
      >
        {{ default: renderPanels }}
      </DashboardShell>
    );
  }
});
