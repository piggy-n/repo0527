import { computed, defineComponent, onMounted, ref, watch, type ComputedRef, type PropType } from 'vue';
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus';
import { usePreferredReducedMotion } from '@vueuse/core';
import { formatValue } from '@/shared/dashboard/calculations';
import { ChartActions, type ChartActionPatch } from '@/shared/dashboard/charts/ChartActions';
import { ChartCard } from '@/shared/dashboard/charts/ChartCard';
import { ChartDetailDialog } from '@/shared/dashboard/charts/ChartDetailDialog';
import chartStyles from '@/shared/dashboard/charts/charts.module.scss';
import { DashboardPlot } from '@/shared/dashboard/charts/DashboardPlot';
import { createChartOption, type DashboardChartOption } from '@/shared/dashboard/charts/options';
import { createRadarOption } from '@/shared/dashboard/charts/radar-options';
import { TooltipTable } from '@/shared/dashboard/charts/TooltipTable';
import { useChartDetail, type ChartSize } from '@/shared/dashboard/charts/useChartDetail';
import { cardPlotSize, useChartDownload } from '@/shared/dashboard/charts/useChartDownload';
import { warmUpChart } from '@/shared/dashboard/charts/warm-up';
import { withUnit } from '@/shared/dashboard/format';
import type { ChartHover, ChartPreference, ChartType } from '@/shared/dashboard/model';
import fonts from '@/shared/dashboard/shell/DashboardFonts.module.scss';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { CARD_CHART_TYPES, LAND_SPACE_CARDS, cardColor, type LandSpaceCardId } from '../cards';
import type { LandSpaceModel } from '../composables/useLandSpaceDashboard';
import { PartTabs } from './PartTabs';
import styles from './LandSpaceCharts.module.scss';

export interface LandSpaceChartsHandle {
  /** 打开某张卡的放大详情；地图点城市时传城市，详情里强调它 */
  openDetail(card: LandSpaceCardId, cityCode?: string | null): void;
}

// 详情图另有的输入：聚焦的城市、详情里单独的图例、弹窗量到的尺寸
interface DetailInput {
  readonly focusedCity: string | null;
  readonly legend: Readonly<Record<string, boolean>>;
  readonly size: ChartSize;
}

/** 右栏固定的三张卡：一级、二级（默认雷达）、三级（标题是下拉框，有分项时下面是分项栏） */
export const LandSpaceCharts = defineComponent({
  name: 'LandSpaceCharts',
  props: {
    model: { type: Object as PropType<LandSpaceModel>, required: true },
    density: { type: Number, default: 1 },
    active: { type: Boolean, default: true },
    revealedCount: { type: Number, default: Infinity },
    reducedMotion: { type: Boolean, default: false }
  },
  emits: {
    /** indicatorId 是卡位（domain、sub、indicator） */
    hover: (_context: ChartHover | null) => true
  },
  setup(props, { emit, expose }) {
    const list = ref<HTMLElement>();
    const pickerOpen = ref(false);
    const preferredMotion = usePreferredReducedMotion();
    const reduced = computed(() => props.reducedMotion || preferredMotion.value === 'reduce');
    const detail = useChartDetail<LandSpaceCardId>({
      legend: card => props.model.preferences.value[card].legend,
      cities: () => props.model.cities.value,
      reset: () => props.model.state.value
    });
    const downloads = useChartDownload();

    // 每张卡单独取偏好：改一张卡的偏好不让另外两张重画
    function cardPreference(card: LandSpaceCardId): ComputedRef<ChartPreference<ChartType>> {
      return computed(() => props.model.preferences.value[card]);
    }
    const preferences: Readonly<Record<LandSpaceCardId, ComputedRef<ChartPreference<ChartType>>>> = {
      domain: cardPreference('domain'),
      sub: cardPreference('sub'),
      indicator: cardPreference('indicator')
    };

    // 雷达用自己的配置；柱、折线的偏好收窄后交给 createChartOption
    function chartOption(
      card: LandSpaceCardId,
      preference: ChartPreference<ChartType>,
      detailInput?: DetailInput
    ): DashboardChartOption {
      const model = props.model;
      const input = {
        indicator: model.metas[card].value,
        color: cardColor(card),
        cities: model.cities.value,
        comparison: model.comparisons[card].value,
        reducedMotion: reduced.value,
        density: props.density,
        ...(detailInput && {
          detail: true,
          focusedCity: detailInput.focusedCity,
          activeYear: model.state.value.activeYear,
          size: detailInput.size
        })
      };
      const legend = detailInput?.legend ?? preference.legend;
      if (preference.type === 'radar') {
        return createRadarOption({ ...input, preference: { ...preference, legend } });
      }
      const { type } = preference;
      return createChartOption({ ...input, preference: { ...preference, type, legend } });
    }

    // 画不出图时的空态：没有指数值的二级、没选城市、雷达的城市不够
    function emptyText(card: LandSpaceCardId): string | undefined {
      const model = props.model;
      if (card === 'sub' && model.notice.value) {
        return model.notice.value;
      }
      const count = model.cities.value.length;
      if (count === 0) {
        return '请选择城市后查看比较数据';
      }
      if (preferences[card].value.type === 'radar' && count < 3) {
        return '雷达图至少需要 3 个城市';
      }
      return undefined;
    }

    function cardView(card: LandSpaceCardId) {
      return computed(() => {
        const preference = preferences[card].value;
        return {
          card,
          meta: props.model.metas[card].value,
          comparison: props.model.comparisons[card].value,
          preference,
          emptyText: emptyText(card),
          option: chartOption(card, preference)
        };
      });
    }
    // 悬停只更新提示，不重建图表配置；切换三级、分项只重算三级卡
    const views = { domain: cardView('domain'), sub: cardView('sub'), indicator: cardView('indicator') };

    const detailOption = computed(() => {
      const card = detail.target.value;
      if (!card) {
        return null;
      }
      return chartOption(card, preferences[card].value, {
        focusedCity: detail.cityCode.value,
        legend: detail.legend.value,
        size: detail.size.value
      });
    });

    function openDetail(card: LandSpaceCardId, cityCode: string | null = null): void {
      emit('hover', null);
      detail.open(card, cityCode);
    }

    // 一级、三级的类型按钮只给出柱和折线
    function setPreference(card: LandSpaceCardId, patch: ChartActionPatch): void {
      const model = props.model;
      if ('showAverage' in patch) {
        model.setPreference(card, patch);
      } else if (card === 'sub') {
        model.setPreference(card, { type: patch.type });
      } else if (patch.type !== 'radar') {
        model.setPreference(card, { type: patch.type });
      }
    }

    // 卡片按屏幕上的绘图区尺寸，详情按弹窗的图表区尺寸；按卡位防重复
    function download(card: LandSpaceCardId, expanded: boolean): void {
      const { name, unit } = props.model.metas[card].value;
      void downloads.download({
        indicator: { id: card, name, unit },
        years: props.model.state.value.years,
        detail: expanded,
        option: expanded ? detailOption.value : views[card].value.option,
        size: expanded ? detail.size.value : cardPlotSize(list.value, card)
      });
    }

    watch(() => props.model.state.value, () => emit('hover', null));

    // 入场揭示图表之前预热：一级的柱图和二级的雷达各画一次，第一次绘制的开销不落在入场动画里
    onMounted(() => {
      if (props.active || reduced.value) {
        return;
      }
      const plot = list.value?.querySelector<HTMLElement>('[role="img"]');
      if (!plot || plot.clientWidth <= 0 || plot.clientHeight <= 0) {
        return;
      }
      const domain = views.domain.value;
      const sub = views.sub.value;
      // 二级和一级是同一种图时只画一次
      const warming = sub.preference.type === domain.preference.type ? [domain] : [domain, sub];
      for (const view of warming.filter(item => !item.emptyText)) {
        warmUpChart(view.option, plot.clientWidth, plot.clientHeight);
      }
    });

    function renderActions(card: LandSpaceCardId, expanded = false) {
      const view = views[card].value;
      const plotted = !view.emptyText;
      return (
        <ChartActions
          prefix={expanded ? '详情图' : view.meta.name}
          types={CARD_CHART_TYPES[card]}
          preference={view.preference}
          averageDisabled={!plotted}
          downloadDisabled={!plotted || downloads.pending(card, expanded)}
          expandLabel={expanded ? undefined : `放大${view.meta.name}图表`}
          downloadLabel={`下载${expanded ? '详情' : view.meta.name}图表`}
          onPreference={patch => setPreference(card, patch)}
          onExpand={() => openDetail(card)}
          onDownload={() => download(card, expanded)}
        />
      );
    }

    // 三级卡的标题：下拉切换当前二级下的三级，标题只写三级名称和单位，分项在下面的分项栏
    function renderPicker(title: string) {
      const model = props.model;
      const currentId = model.indicator.value.id;
      return (
        <ElDropdown
          class={styles.picker}
          trigger="click"
          placement="bottom-start"
          popperClass={styles.pickerPopper}
          showArrow={false}
          maxHeight="min(60vh, 460px)"
          onVisible-change={(visible: boolean) => {
            pickerOpen.value = visible;
          }}
        >
          {{
            default: () => (
              <button type="button" class={[chartStyles.title, styles.pickerButton]} title={title}>
                <span>{title}</span>
                <SvgIcon name="dashboard-chevron" rotate={pickerOpen.value ? 270 : 90} />
              </button>
            ),
            dropdown: () => (
              <ElDropdownMenu aria-label="当前二级指标下的三级指标">
                {model.subIndex.value.indicators.map(item => (
                  <ElDropdownItem
                    key={item.id}
                    class={item.id === currentId && styles.current}
                    aria-current={item.id === currentId ? 'true' : undefined}
                    onClick={() => model.selectIndicator(item.id)}
                  >
                    {withUnit(item.name, item.unit)}
                  </ElDropdownItem>
                ))}
              </ElDropdownMenu>
            )
          }}
        </ElDropdown>
      );
    }

    function renderCard(card: LandSpaceCardId, index: number) {
      const model = props.model;
      const { meta, comparison, emptyText: empty, option, preference } = views[card].value;
      const latest = comparison.at(-1);
      const indicator = model.indicator.value;
      const title = card === 'indicator' ? withUnit(indicator.name, indicator.unit) : withUnit(meta.name, meta.unit);
      const withParts = card === 'indicator' && model.parts.value.length >= 2;
      const radar = preference.type === 'radar';
      return (
        <ChartCard
          key={card}
          id={card}
          title={title}
          class={[styles.card, withParts && styles.withParts]}
          average={latest ? {
            year: latest.year,
            text: formatValue(latest.average, meta, true, Math.max(1, meta.precision))
          } : null}
          emptyText={empty}
        >
          {{
            ...(card === 'indicator' && { heading: () => renderPicker(title) }),
            actions: () => renderActions(card),
            ...(withParts && {
              toolbar: () => (
                <PartTabs
                  parts={model.parts.value}
                  selected={model.state.value.partId}
                  label={`${indicator.name}的分项`}
                  reducedMotion={reduced.value}
                  onSelect={model.selectPart}
                />
              )
            }),
            default: () => (
              <DashboardPlot
                option={option}
                active={index < props.revealedCount}
                cities={model.cities.value}
                hoverMode={radar ? 'none' : 'axis'}
                description={`${meta.name}各市比较`}
                onHover={cityCode => emit('hover', cityCode ? { indicatorId: card, cityCode } : null)}
                onLegend={legend => model.setPreference(card, { legend })}
              />
            )
          }}
        </ChartCard>
      );
    }

    function renderDetail() {
      const model = props.model;
      const card = detail.target.value;
      const view = card ? views[card].value : null;
      return (
        <ChartDetailDialog
          visible={detail.visible.value}
          title={view ? withUnit(view.meta.name, view.meta.unit) : ''}
          description={`${view?.meta.name ?? ''}详情`}
          focusText={detail.focusText.value}
          option={() => (view && !view.emptyText ? detailOption.value : null)}
          emptyText={view?.emptyText}
          cities={model.cities.value}
          hoverMode={view?.preference.type === 'radar' ? 'none' : 'axis'}
          onClose={detail.close}
          onHover={detail.setHover}
          onLegend={detail.setLegend}
          onSize={detail.setSize}
        >
          {{
            actions: () => card && renderActions(card, true),
            tooltip: () => card && view && detail.hoveredCity.value && (
              <TooltipTable
                indicator={view.meta}
                color={cardColor(card)}
                comparison={view.comparison}
                cities={model.cities.value}
                city={detail.hoveredCity.value}
                activeYear={model.state.value.activeYear}
                legend={detail.legend.value}
              />
            )
          }}
        </ChartDetailDialog>
      );
    }

    expose({ openDetail });
    return () => (
      <section class={[fonts.scope, chartStyles.column]} aria-label="一级、二级、三级指标图表" inert={!props.active}>
        {downloads.error.value && <p role="alert">{downloads.error.value}</p>}
        <div
          ref={list}
          class={[chartStyles.cardList, styles.list]}
          data-card-list
          onScroll={() => emit('hover', null)}
        >
          {LAND_SPACE_CARDS.map(renderCard)}
        </div>
        {renderDetail()}
      </section>
    );
  }
});
