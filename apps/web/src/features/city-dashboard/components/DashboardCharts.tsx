import { computed, defineComponent, ref, shallowRef, watch, type PropType } from 'vue';
import { ElButton, ElDialog } from 'element-plus';
import { MxTitle } from '@yzt/ui';
import { usePreferredReducedMotion, useResizeObserver } from '@vueuse/core';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { CITIES } from '../catalog';
import { formatValue } from '../calculations';
import type { ChartHover, Indicator } from '../model';
import type { DashboardModel } from '../composables/useDashboard';
import { createChartOption, isStacked } from '../charts/options';
import { DashboardPlot } from './DashboardPlot';
import { TooltipTable } from './TooltipTable';
import fonts from './DashboardFonts.module.scss';
import styles from './DashboardCharts.module.scss';
import { useImageExport } from '../composables/useImageExport';
import { imageWithTitle, saveImage } from '../export/image-export';
import { renderChartImage } from '../export/chart-export';
import { useCardNavigation } from '../composables/useCardNavigation';

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
    hover: (_context: ChartHover | null) => true,
    select: (_id: string) => true
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
    const detailPlot = ref<HTMLElement>();
    const detailSize = shallowRef({ width: 780, height: 440 });
    const exporting = useImageExport();
    useResizeObserver(detailPlot, entries => {
      const size = entries[0]?.contentRect;
      if (size && size.width > 0 && size.height > 0) {
        detailSize.value = { width: size.width, height: size.height };
      }
    });
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

    watch(() => props.model.state.value, () => {
      emit('hover', null);
      detailHover.value = null;
    });
    watch(() => props.model.state.value.categoryId, closeDetail);

    /** 卡片和详情复用操作入口，下载状态按指标和视图分别记录 */
    function renderActions(indicator: Indicator, expanded = false) {
      const model = props.model;
      const preference = model.preference(indicator);
      const comparison = model.comparisons.value.get(indicator.id) ?? [];
      const stacked = isStacked({ comparison, preference });
      const prefix = expanded ? '详情图' : indicator.name;
      const exportKey = `${expanded ? 'detail' : 'card'}:${indicator.id}`;
      const cannotDownload = !comparison.length || !model.cities.value.length || exporting.pending.value.has(exportKey);
      return (
        <div class={styles.actions}>
          <button
            type="button"
            class={[styles.iconButton, preference.showAverage && !stacked && styles.averageActive]}
            aria-label={`${prefix}${preference.showAverage ? '隐藏' : '显示'}均值线`}
            aria-pressed={preference.showAverage && !stacked}
            title={stacked ? '堆叠模式只在提示表格显示逐年均值' : '显示或隐藏均值线'}
            disabled={stacked || !comparison.length || !model.cities.value.length}
            onClick={() => model.setPreference(indicator, { showAverage: !preference.showAverage })}
          >
            <SvgIcon name="dashboard-average" />
          </button>
          <button
            type="button"
            class={[styles.iconButton, preference.type === 'line' && styles.lineType]}
            aria-label={`${prefix}切换为${preference.type === 'bar' ? '折线' : '柱状'}图`}
            title={`切换为${preference.type === 'bar' ? '折线' : '柱状'}图`}
            onClick={() => model.setPreference(indicator, { type: preference.type === 'bar' ? 'line' : 'bar' })}
          >
            <SvgIcon name={preference.type === 'bar' ? 'dashboard-line' : 'dashboard-bar'} />
          </button>
          {!expanded && (
            <button
              type="button"
              class={styles.iconButton}
              aria-label={`放大${indicator.name}图表`}
              title="放大图表"
              onClick={() => openDetail({ indicatorId: indicator.id })}
            >
              <SvgIcon name="dashboard-expand" />
            </button>
          )}
          <button
            type="button"
            class={styles.iconButton}
            aria-label={`下载${expanded ? '详情' : indicator.name}图表`}
            title="下载图片"
            disabled={cannotDownload}
            onClick={() => void download(indicator, expanded)}
          >
            <SvgIcon name="dashboard-download" />
          </button>
        </div>
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
      const title = `${indicator.name}（${indicator.unit}）`;
      const years = props.model.comparisonYears.value.join('-');
      const blob = await exporting.run(`${expanded ? 'detail' : 'card'}:${indicator.id}`, async signal => {
        await exporting.waitForFonts(signal);
        return imageWithTitle(renderChartImage(option, Math.max(1, size.width), Math.max(1, size.height)), title);
      });
      if (blob) {
        saveImage(blob, `${years}-${indicator.name}${expanded ? '-详情' : ''}`);
      }
    }

    expose({ locateIndicator, openDetail });
    return () => {
      const model = props.model;
      const state = model.state.value;
      const selected = detail.value?.indicator;
      const comparison = selected ? model.comparisons.value.get(selected.id) ?? [] : [];
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
            {cards.value.map(({ indicator, comparison: cardComparison, option }, index) => {
              const latest = cardComparison.at(-1);
              const average = latest
                ? formatValue(latest.average, indicator, true, Math.max(1, indicator.precision))
                : null;
              return (
                <article
                  key={`${state.categoryId}:${indicator.id}`}
                  data-chart-id={indicator.id}
                  data-enter="chart"
                  class={[
                    styles.card,
                    state.indicatorId === indicator.id && navigation.locatingId.value !== indicator.id && styles.selected
                  ]}
                  aria-current={state.indicatorId === indicator.id ? 'true' : undefined}
                >
                  <div class={styles.heading}>
                    <button
                      type="button"
                      class={styles.title}
                      title={`${indicator.name}（${indicator.unit}）`}
                      onClick={() => {
                        model.selectIndicator(indicator.id);
                        emit('select', indicator.id);
                      }}
                    >
                      {indicator.name}（{indicator.unit}）
                    </button>
                    {renderActions(indicator)}
                  </div>
                  <div class={styles.average}>
                    {latest ? (
                      <span aria-label="最新所选年份的城市平均值">
                        <i aria-hidden="true" />
                        {latest.year}均值 <b>{average}</b>
                      </span>
                    ) : '未选择比较年份'}
                  </div>
                  <div class={styles.body}>
                    {cardComparison.length && model.cities.value.length ? (
                      <DashboardPlot
                        option={option}
                        active={index < props.revealedCount}
                        retain={navigation.touchingId.value === indicator.id}
                        cities={model.cities.value}
                        description={`${indicator.name}多年度比较`}
                        onHover={cityCode => emit('hover', cityCode ? { indicatorId: indicator.id, cityCode } : null)}
                        onLegend={legend => model.setPreference(indicator, { legend })}
                      />
                    ) : (
                      <div class={styles.empty}>
                        {cardComparison.length ? '请选择城市后查看比较数据' : '请选择年份后查看比较数据'}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <ElDialog
            class={['dialog-panel-header', styles.dialog]}
            title="指标图表详情"
            width="min(1100px, 94vw)"
            top="6vh"
            appendToBody
            destroyOnClose
            modelValue={detailVisible.value}
            onUpdate:modelValue={value => {
              if (!value) {
                closeDetail();
              }
            }}
          >
            {{
              header: () => <MxTitle level="panel">指标图表详情</MxTitle>,
              default: () => selected && <div class={styles.detail}>
                <h2 class={styles.fullTitle}>{selected.name}（{selected.unit}）</h2>
                <div class={styles.detailTools}>
                  <span>{focusedCity.value?.name}{focusedCity.value && (
                    model.cities.value.includes(focusedCity.value)
                      ? ' · 当前查看城市' : ' · 未纳入当前城市筛选'
                  )}</span>
                  {renderActions(selected, true)}
                </div>
                <div class={styles.detailScroll}>
                  {comparison.length && model.cities.value.length && detailOption.value ?
                    <div ref={detailPlot} class={styles.detailPlot}>
                      <DashboardPlot
                        option={detailOption.value}
                        cities={model.cities.value}
                        active={detailVisible.value}
                        description={`${selected.name}详情`}
                        onHover={code => {
                          detailHover.value = code;
                        }}
                        onLegend={legend => {
                          detailLegend.value = legend;
                        }}
                      />
                    </div> : <div class={styles.empty}>暂无比较数据</div>}
                </div>
                {hoveredCity.value && <div class={styles.detailTooltip}>
                  <TooltipTable
                    indicator={selected}
                    comparison={comparison}
                    cities={model.cities.value}
                    city={hoveredCity.value}
                    activeYear={state.activeYear}
                    chartType={model.preference(selected).type}
                    legend={detailLegend.value}
                  />
                </div>}
              </div>,
              footer: () => <ElButton onClick={closeDetail}>关闭</ElButton>
            }}
          </ElDialog>
        </section>
      );
    };
  }
});
