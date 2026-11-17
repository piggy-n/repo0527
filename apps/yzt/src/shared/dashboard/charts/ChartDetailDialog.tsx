import { Comment, defineComponent, ref, type PropType, type SlotsType, type VNode } from 'vue';
import { ElButton, ElDialog } from 'element-plus';
import { MxTitle } from '@mx/ui';
import { useResizeObserver } from '@vueuse/core';
import type { City } from '../model';
import type { DashboardChartOption } from './options';
import { DashboardPlot } from './DashboardPlot';
import styles from './charts.module.scss';

// 插槽函数没内容时（如 cond && <X />）返回注释节点
function hasContent(nodes: readonly VNode[] | undefined): nodes is readonly VNode[] {
  return nodes?.some(node => node.type !== Comment) ?? false;
}

/** 图表详情弹窗：完整标题、聚焦城市的说明、操作、放大的图表和悬停城市的提示表格；数据和状态由调用方持有 */
export const ChartDetailDialog = defineComponent({
  name: 'DashboardChartDetailDialog',
  props: {
    visible: { type: Boolean, required: true },
    /** 完整标题（带单位） */
    title: { type: String, required: true },
    /** 图表的读屏说明 */
    description: { type: String, required: true },
    /** 标题下方左侧的说明，如聚焦的城市 */
    focusText: { type: String, default: '' },
    /** 取图表配置，返回 null 时显示空态；弹窗内容渲染时才调用，关着的弹窗不计算详情配置 */
    option: { type: Function as PropType<() => DashboardChartOption | null>, required: true },
    cities: { type: Array as PropType<readonly City[]>, required: true },
    hoverMode: { type: String as PropType<'axis' | 'none'>, default: 'axis' },
    emptyText: { type: String, default: '暂无比较数据' }
  },
  emits: {
    close: () => true,
    hover: (_code: string | null) => true,
    legend: (_selected: Readonly<Record<string, boolean>>) => true,
    size: (_size: { width: number; height: number }) => true
  },
  slots: Object as SlotsType<{
    actions?: () => VNode[];
    tooltip?: () => VNode[];
  }>,
  setup(props, { emit, slots }) {
    const plot = ref<HTMLElement>();
    useResizeObserver(plot, entries => {
      const size = entries[0]?.contentRect;
      if (size && size.width > 0 && size.height > 0) {
        emit('size', { width: size.width, height: size.height });
      }
    });

    function renderPlot() {
      const option = props.option();
      if (!option) {
        return <div class={styles.empty}>{props.emptyText}</div>;
      }
      return (
        <div ref={plot} class={styles.detailPlot}>
          <DashboardPlot
            option={option}
            cities={props.cities}
            active={props.visible}
            hoverMode={props.hoverMode}
            description={props.description}
            onHover={code => emit('hover', code)}
            onLegend={legend => emit('legend', legend)}
          />
        </div>
      );
    }

    function renderDetail() {
      const tooltip = slots.tooltip?.();
      return (
        <div class={styles.detail}>
          <h2 class={styles.fullTitle}>{props.title}</h2>
          <div class={styles.detailTools}>
            <span>{props.focusText}</span>
            {slots.actions?.()}
          </div>
          <div class={styles.detailScroll}>{renderPlot()}</div>
          {hasContent(tooltip) && <div class={styles.detailTooltip}>{tooltip}</div>}
        </div>
      );
    }

    return () => (
      <ElDialog
        class={['dialog-panel-header', styles.dialog]}
        title="指标图表详情"
        width="min(1100px, 94vw)"
        top="6vh"
        appendToBody
        destroyOnClose
        modelValue={props.visible}
        onUpdate:modelValue={value => {
          if (!value) {
            emit('close');
          }
        }}
      >
        {{
          header: () => <MxTitle level="panel">指标图表详情</MxTitle>,
          default: renderDetail,
          footer: () => <ElButton onClick={() => emit('close')}>关闭</ElButton>
        }}
      </ElDialog>
    );
  }
});
