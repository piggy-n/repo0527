import { computed, defineComponent, onMounted, ref, shallowRef, watch, type PropType } from 'vue';
import { usePreferredReducedMotion } from '@vueuse/core';
import { formatValue } from '@/shared/dashboard/calculations';
import { ChartActions, type ChartActionPatch } from '@/shared/dashboard/charts/ChartActions';
import { ChartCard } from '@/shared/dashboard/charts/ChartCard';
import { ChartDetailDialog } from '@/shared/dashboard/charts/ChartDetailDialog';
import { renderChartImage } from '@/shared/dashboard/charts/chart-export';
import chartStyles from '@/shared/dashboard/charts/charts.module.scss';
import { DashboardPlot } from '@/shared/dashboard/charts/DashboardPlot';
import { createChartOption, isStacked } from '@/shared/dashboard/charts/options';
import { TooltipTable } from '@/shared/dashboard/charts/TooltipTable';
import { warmUpChart } from '@/shared/dashboard/charts/warm-up';
import { imageWithTitle, saveImage } from '@/shared/dashboard/export/image-export';
import { useImageExport } from '@/shared/dashboard/export/useImageExport';
import { withUnit } from '@/shared/dashboard/format';
import fonts from '@/shared/dashboard/shell/DashboardFonts.module.scss';
import { CITIES } from '../catalog';
import { yearColor } from '../charts/colors';
import { useCardNavigation } from '../composables/useCardNavigation';
import type { DashboardModel } from '../composables/useDashboard';
import type { ChartHover, Indicator } from '../model';
import styles from './DashboardCharts.module.scss';

export interface DashboardChartsHandle {
  locateIndicator(id: string, options?: { scroll?: boolean }): void;
  openDetail(context: { indicatorId: string; cityCode?: string | null }): void;
}

/** 卡片和详情共享类型、均值偏好，详情图例在打开时复制后独立维护 */
export const DashboardCharts = defineComponent({
  name: 'DashboardCharts',
  props: {
    model: { type: Object as PropType<DashboardModel>, required: true },
    density: { type: Number, default: 1 },
    active: { type: Boolean, default: true },
    revealedCount: { type: Number, default: Infinity },
    reducedMotion: { type: Boolean, default: false }
  },
  emits: {
    hover: (_context: ChartHover | null) => true
  },
  setup(props, { emit, expose }) {
    const list = ref<HTMLElement>();
    const reducedMotion = usePreferredReducedMotion();
    const reduced = computed(() => props.reducedMotion || reducedMotion.value === 'reduce');
    const navigation = useCardNavigation(list, {
      ready: () => props.active,
      reduced: () => reduced.value,
      category: () => props.model.state.value.categoryId
    });
    const detail = shallowRef<{ indicator: Indicator; cityCode: string | null } | null>(null);
    const detailLegend = shallowRef<Readonly<Record<string, boolean>>>({});
    const detailHover = ref<string | null>(null);
    const detailVisible = ref(false);
    const detailSize = shallowRef({ width: 780, height: 440 });
    const exporting = useImageExport();
    const focusedCity = computed(() => CITIES.find(city => city.code === detail.value?.cityCode));
    const hoveredCity = computed(() => CITIES.find(city => city.code === detailHover.value));
    // 从当前列表读取卡片，避免重渲染期间旧 ref 清理影响定位
    const cardElements = () => [...list.value?.querySelectorAll<HTMLElement>('[data-chart-id]') ?? []];
    // 悬停只更新提示，不重建整组图表配置，避免 setOption 与指示器事件互相触发
    const cards = computed(() => props.model.category.value.indicators.map(indicator => {
      const comparison = props.model.comparisons.value.get(indicator.id) ?? [];
      const preference = props.model.preference(indicator);
      return {
        indicator,
        comparison,
        option: createChartOption({
          indicator,
          color: year => yearColor(year, indicator.id),
          cities: props.model.cities.value,
          comparison,
          preference,
          reducedMotion: reduced.value,
          density: props.density
        })
      };
    }));
    const detailOption = computed(() => {
      const selected = detail.value;
      if (!selected) {
        return null;
      }
      return createChartOption({
        indicator: selected.indicator,
        color: year => yearColor(year, selected.indicator.id),
        cities: props.model.cities.value,
        comparison: props.model.comparisons.value.get(selected.indicator.id) ?? [],
        preference: { ...props.model.preference(selected.indicator), legend: detailLegend.value },
        detail: true,
        focusedCity: selected.cityCode,
        activeYear: props.model.state.value.activeYear,
        size: detailSize.value,
        reducedMotion: reduced.value
      });
    });

    function locateIndicator(id: string, { scroll = true }: { scroll?: boolean } = {}): void {
      void navigation.locateIndicator(id, { scroll });
    }

    function openDetail({ indicatorId, cityCode = null }: { indicatorId: string; cityCode?: string | null }): void {
      const indicator = props.model.category.value.indicators.find(item => item.id === indicatorId);
      if (!indicator) {
        return;
      }
      emit('hover', null);
      detail.value = { indicator, cityCode };
      detailLegend.value = { ...props.model.preference(indicator).legend };
      detailHover.value = null;
      detailVisible.value = true;
    }

    function closeDetail(): void {
      detailVisible.value = false;
      detailHover.value = null;
    }

    // 原驾驶舱只有柱状和折线，类型按钮不会给出雷达
    function setPreference(indicator: Indicator, patch: ChartActionPatch): void {
      if ('showAverage' in patch) {
        props.model.setPreference(indicator, patch);
      } else if (patch.type !== 'radar') {
        props.model.setPreference(indicator, { type: patch.type });
      }
    }

    watch(
      () => props.model.state.value,
      () => {
        emit('hover', null);
        detailHover.value = null;
      }
    );
    watch(() => props.model.state.value.categoryId, closeDetail);

    // 入场揭示图表之前预热一次：挂载时页面还没绘制、没有动画，第一次绘制的开销放在这里
    onMounted(() => {
      if (props.active || reduced.value) {
        return;
      }
      const card = cards.value.find(item => item.comparison.length);
      const plot = list.value?.querySelector<HTMLElement>('[role="img"]');
      if (card && plot && plot.clientWidth > 0 && plot.clientHeight > 0) {
        warmUpChart(card.option, plot.clientWidth, plot.clientHeight);
      }
    });

    /** 卡片和详情复用操作入口，下载状态按指标和视图分别记录 */
    function renderActions(indicator: Indicator, expanded = false) {
      const model = props.model;
      const preference = model.preference(indicator);
      const comparison = model.comparisons.value.get(indicator.id) ?? [];
      const stacked = isStacked({ comparison, preference });
      const exportKey = `${expanded ? 'detail' : 'card'}:${indicator.id}`;
      const cannotDownload = !comparison.length || !model.cities.value.length || exporting.pending.value.has(exportKey);
      return (
        <ChartActions
          prefix={expanded ? '详情图' : indicator.name}
          preference={{ ...preference, showAverage: preference.showAverage && !stacked }}
          averageDisabled={stacked || !comparison.length || !model.cities.value.length}
          averageTitle={stacked ? '堆叠模式只在提示表格显示逐年均值' : '显示或隐藏均值线'}
          downloadDisabled={cannotDownload}
          expandLabel={expanded ? undefined : `放大${indicator.name}图表`}
          downloadLabel={`下载${expanded ? '详情' : indicator.name}图表`}
          onPreference={patch => setPreference(indicator, patch)}
          onExpand={() => openDetail({ indicatorId: indicator.id })}
          onDownload={() => void download(indicator, expanded)}
        />
      );
    }

    async function download(indicator: Indicator, expanded: boolean): Promise<void> {
      const option = expanded
        ? detailOption.value
        : cards.value.find(card => card.indicator.id === indicator.id)?.option;
      if (!option) {
        return;
      }
      const cardElement = cardElements().find(card => card.dataset.chartId === indicator.id);
      const element = cardElement?.querySelector<HTMLElement>('[role="img"]');
      const size = expanded ? detailSize.value : {
        width: element?.clientWidth ?? 420,
        height: element?.clientHeight ?? 240
      };
      const title = withUnit(indicator.name, indicator.unit);
      const years = props.model.comparisonYears.value.join('-');
      const blob = await exporting.run(`${expanded ? 'detail' : 'card'}:${indicator.id}`, async signal => {
        await exporting.waitForFonts(signal);
        return imageWithTitle(renderChartImage(option, Math.max(1, size.width), Math.max(1, size.height)), title);
      });
      if (blob) {
        saveImage(blob, `${years}-${indicator.name}${expanded ? '-详情' : ''}`);
      }
    }

    // 详情里聚焦的城市；它不在当前的城市筛选里时也说明
    function focusedCityText(): string {
      const city = focusedCity.value;
      if (!city) {
        return '';
      }
      return props.model.cities.value.includes(city) ? `${city.name} · 当前查看城市` : `${city.name} · 未纳入当前城市筛选`;
    }

    function renderDetail() {
      const model = props.model;
      const selected = detail.value?.indicator;
      const comparison = selected ? model.comparisons.value.get(selected.id) ?? [] : [];
      const plotted = comparison.length > 0 && model.cities.value.length > 0;
      return (
        <ChartDetailDialog
          visible={detailVisible.value}
          title={selected ? withUnit(selected.name, selected.unit) : ''}
          description={`${selected?.name ?? ''}详情`}
          focusText={focusedCityText()}
          option={plotted ? detailOption.value : null}
          cities={model.cities.value}
          onClose={closeDetail}
          onHover={code => (detailHover.value = code)}
          onLegend={legend => (detailLegend.value = legend)}
          onSize={size => (detailSize.value = size)}
        >
          {{
            actions: () => selected && renderActions(selected, true),
            tooltip: () => selected && hoveredCity.value && (
              <TooltipTable
                indicator={selected}
                color={year => yearColor(year, selected.id)}
                comparison={comparison}
                cities={model.cities.value}
                city={hoveredCity.value}
                activeYear={model.state.value.activeYear}
                legend={detailLegend.value}
              />
            )
          }}
        </ChartDetailDialog>
      );
    }

    expose({ locateIndicator, openDetail });
    return () => {
      const model = props.model;
      const state = model.state.value;
      return (
        <section class={[fonts.scope, styles.charts]} aria-label="当前指标类型的多年度图表" inert={!props.active}>
          {exporting.error.value && <p role="alert">{exporting.error.value}</p>}
          <div
            ref={list}
            class={styles.list}
            tabindex={0}
            role="region"
            aria-label="指标图表列表，使用上下方向键逐项切换"
            data-card-list
            data-ready={props.active}
            onScroll={() => emit('hover', null)}
          >
            {cards.value.map(({ indicator, comparison, option }, index) => {
              // 定位中的卡片先不显示选中，定位结束再显示，免得滚动途中闪一下
              const selected = state.indicatorId === indicator.id && navigation.locatingId.value !== indicator.id;
              const latest = comparison.at(-1);
              const title = withUnit(indicator.name, indicator.unit);
              let emptyText: string | undefined;
              if (!comparison.length) {
                emptyText = '请选择年份后查看比较数据';
              } else if (!model.cities.value.length) {
                emptyText = '请选择城市后查看比较数据';
              }
              return (
                <ChartCard
                  key={`${state.categoryId}:${indicator.id}`}
                  id={indicator.id}
                  title={title}
                  class={selected && styles.selected}
                  current={state.indicatorId === indicator.id}
                  average={latest ? {
                    year: latest.year,
                    text: formatValue(latest.average, indicator, true, Math.max(1, indicator.precision))
                  } : null}
                  emptyText={emptyText}
                >
                  {{
                    heading: () => (
                      <button
                        type="button"
                        class={chartStyles.title}
                        title={title}
                        onClick={() => model.selectIndicator(indicator.id)}
                      >
                        {title}
                      </button>
                    ),
                    actions: () => renderActions(indicator),
                    default: () => (
                      <DashboardPlot
                        option={option}
                        active={index < props.revealedCount}
                        retain={navigation.touchingId.value === indicator.id}
                        cities={model.cities.value}
                        description={`${indicator.name}多年度比较`}
                        onHover={cityCode => emit('hover', cityCode ? { indicatorId: indicator.id, cityCode } : null)}
                        onLegend={legend => model.setPreference(indicator, { legend })}
                      />
                    )
                  }}
                </ChartCard>
              );
            })}
          </div>
          {renderDetail()}
        </section>
      );
    };
  }
});
