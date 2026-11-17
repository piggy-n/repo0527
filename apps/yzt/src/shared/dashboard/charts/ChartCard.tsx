import { defineComponent, type PropType, type SlotsType } from 'vue';
import styles from './charts.module.scss';

/** 卡片的外壳：标题行（标题、操作）、可选的工具栏、均值摘要、图表或空态；入场按 data-enter="chart" 找卡片 */
export const ChartCard = defineComponent({
  name: 'DashboardChartCard',
  props: {
    /** 写进 data-chart-id，列表定位、下载按它找卡片 */
    id: { type: String, required: true },
    /** 完整标题，悬停时显示 */
    title: { type: String, required: true },
    /** 最新所选年份的城市平均值；没有比较年份时为 null */
    average: { type: Object as PropType<{ readonly year: number; readonly text: string } | null>, default: null },
    /** 有值时图表区显示这段空态 */
    emptyText: { type: String, default: undefined },
    /** 是否是当前指标，写 aria-current */
    current: { type: Boolean, default: false }
  },
  slots: Object as SlotsType<{
    heading?: () => unknown;
    actions?: () => unknown;
    toolbar?: () => unknown;
    default?: () => unknown;
  }>,
  setup(props, { slots }) {
    return () => (
      <article
        data-chart-id={props.id}
        data-enter="chart"
        class={styles.card}
        aria-current={props.current ? 'true' : undefined}
      >
        <div class={styles.heading}>
          {slots.heading?.() ?? (
            <h3 class={[styles.title, styles.titleText]} title={props.title}>
              {props.title}
            </h3>
          )}
          {slots.actions?.()}
        </div>
        {slots.toolbar?.()}
        <div class={styles.average}>
          {props.average ? (
            <span aria-label="最新所选年份的城市平均值">
              <i aria-hidden="true" />
              {props.average.year}均值 <b>{props.average.text}</b>
            </span>
          ) : '未选择比较年份'}
        </div>
        <div class={styles.body}>
          {props.emptyText ? <div class={styles.empty}>{props.emptyText}</div> : slots.default?.()}
        </div>
      </article>
    );
  }
});
