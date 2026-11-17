import { computed, defineComponent, ref } from 'vue';
import { useDocumentVisibility } from '@vueuse/core';
import { DASHBOARD_CITIES } from '@/shared/dashboard/cities';
import { CityFilter } from '@/shared/dashboard/filters/CityFilter';
import { FilterPanel } from '@/shared/dashboard/filters/FilterPanel';
import { FilterSection } from '@/shared/dashboard/filters/FilterSection';
import { IconOptionList, type IconOption } from '@/shared/dashboard/filters/IconOptionList';
import { OptionList } from '@/shared/dashboard/filters/OptionList';
import { YearFilter } from '@/shared/dashboard/filters/YearFilter';
import { withUnit } from '@/shared/dashboard/format';
import { DashboardCompass } from '@/shared/dashboard/map/DashboardCompass';
import { DashboardMap } from '@/shared/dashboard/map/DashboardMap';
import { DashboardScaleBar } from '@/shared/dashboard/map/DashboardScaleBar';
import type { MapCornerScope, MapView } from '@/shared/dashboard/map/types';
import { DashboardShell, type DashboardShellScope } from '@/shared/dashboard/shell/DashboardShell';
import { TooltipLayer } from '@/shared/dashboard/tooltip/TooltipLayer';
import { useDashboardTooltip } from '@/shared/dashboard/tooltip/useDashboardTooltip';
import type { IconName } from '@/shared/icons/SvgIcon';
import { LAND_SPACE_CARDS, cardColor } from '../cards';
import { useLandSpaceDashboard } from '../composables/useLandSpaceDashboard';
import { LAND_SPACE_DOMAINS, type LandSpaceDomainId } from '../data/land-space-data';
import { LandSpaceCharts, type LandSpaceChartsHandle } from './LandSpaceCharts';
import styles from './LandSpaceView.module.scss';

const domainIcons: Record<LandSpaceDomainId, IconName> = {
  livability: 'dashboard-livability',
  'public-resources': 'dashboard-public-resources',
  'public-services': 'dashboard-public-services',
  'urban-safety': 'dashboard-urban-safety',
  transport: 'dashboard-transport',
  building: 'dashboard-building'
};

const domainOptions: readonly IconOption[] = LAND_SPACE_DOMAINS.map(domain => ({
  id: domain.id,
  name: domain.name,
  icon: domainIcons[domain.id]
}));

/** 综合分析驾驶舱：外壳、筛选、地图和三张卡都来自 shared/dashboard，这里只组合并接上状态 */
export const LandSpaceView = defineComponent({
  name: 'LandSpaceView',
  props: {
    /** 不创建三维场景，直接用二维地图；测试用 */
    forceFallback: { type: Boolean, default: false },
    /** 减少动画：入场直接到终态 */
    reducedMotion: { type: Boolean, default: false }
  },
  setup(props) {
    const model = useLandSpaceDashboard();
    const charts = ref<LandSpaceChartsHandle>();
    const visibility = useDocumentVisibility();
    const tooltip = useDashboardTooltip({ reset: model.state, visibility });
    // 提示的 indicatorId 是卡位：地图悬停是二级卡
    const tooltipCard = computed(() => LAND_SPACE_CARDS.find(card => card === tooltip.context.value?.indicatorId));
    const tooltipCity = computed(() => DASHBOARD_CITIES.find(city => city.code === tooltip.context.value?.cityCode));
    const subOptions = computed(() => model.domain.value.subIndices.map(sub => ({ id: sub.id, label: sub.name })));
    const mapTitle = computed(() => {
      const { name, unit } = model.subIndex.value;
      return `${model.state.value.activeYear}年江苏省${withUnit(`${name}分布图`, unit)}`;
    });

    /** 地图点城市打开二级卡的详情并强调这个城市，打开前关闭悬停提示 */
    function openMapDetail(cityCode: string): void {
      tooltip.close();
      charts.value?.openDetail('sub', cityCode);
    }

    function hoverMap(cityCode: string | null): void {
      tooltip.show('map', cityCode ? { indicatorId: 'sub', cityCode } : null);
    }

    function renderTooltip() {
      const card = tooltipCard.value;
      const city = tooltipCity.value;
      if (!card || !city) {
        return null;
      }
      return (
        <TooltipLayer
          indicator={model.metas[card].value}
          color={cardColor(card)}
          city={city}
          cities={model.cities.value}
          comparison={model.comparisons[card].value}
          activeYear={model.state.value.activeYear}
          legend={model.preferences.value[card].legend}
          onKeepOpen={tooltip.keepOpen}
          onLeave={tooltip.leave}
        />
      );
    }

    function renderFilters(active: boolean) {
      const state = model.state.value;
      return (
        <FilterPanel active={active}>
          <YearFilter
            options={model.availableYears}
            selected={state.years}
            clearable={false}
            onChange={model.setYears}
          />
          <CityFilter
            cities={DASHBOARD_CITIES}
            selected={state.cityCodes}
            onToggle={model.toggleCity}
            onSet={model.setCities}
          />
          <FilterSection title="一级指标">
            <IconOptionList options={domainOptions} selected={state.domainId} onSelect={model.selectDomain} />
          </FilterSection>
          <FilterSection title="二级指标" fill>
            <OptionList
              options={subOptions.value}
              selected={state.subIndexId}
              label="二级指标列表"
              resetKey={state.domainId}
              onSelect={model.selectSubIndex}
            />
          </FilterSection>
        </FilterPanel>
      );
    }

    // 三栏：筛选、地图、图表；入场状态和缩放由外壳给出
    function renderPanels({ entrance, density }: DashboardShellScope) {
      const ready = entrance.phase.value === 'ready';
      return [
        renderFilters(ready),
        <DashboardMap
          indicator={model.metas.sub.value}
          title={mapTitle.value}
          values={model.mapValues.value}
          classification={model.classification.value}
          years={model.state.value.years}
          activeYear={model.state.value.activeYear}
          showValues={false}
          notice={model.notice.value}
          forceFallback={props.forceFallback}
          reducedMotion={entrance.reduced.value}
          active={ready}
          valuesVisible={entrance.valuesVisible.value}
          onSettled={() => void entrance.mapSettled()}
          onHover={hoverMap}
          onDetail={openMapDetail}
          onYear={model.setActiveYear}
        >
          {{
            default: renderTooltip,
            topRight: (view: MapView | null) => [<DashboardCompass rotation={view?.northDegrees ?? 0} />],
            bottomRight: ({ view, maxWidth }: MapCornerScope) =>
              view ? [<DashboardScaleBar metersPerPixel={view.metersPerPixel} maxWidth={maxWidth} />] : []
          }}
        </DashboardMap>,
        <LandSpaceCharts
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
        class={styles.shell}
        title="江苏省城市国土空间监测综合分析"
        traceName="land-space-dashboard"
        reducedMotion={props.reducedMotion}
        onEscape={tooltip.close}
      >
        {{ default: renderPanels }}
      </DashboardShell>
    );
  }
});
