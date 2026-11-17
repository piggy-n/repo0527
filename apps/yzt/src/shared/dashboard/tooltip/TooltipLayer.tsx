import { defineComponent, type PropType } from 'vue';
import type { City, Comparison, IndicatorMeta } from '../model';
import { TooltipTable } from '../charts/TooltipTable';
import styles from './TooltipLayer.module.scss';

/** 地图和图表共用的悬停提示：贴在地图标题下方，移入表格时保持打开 */
export const TooltipLayer = defineComponent({
  name: 'DashboardTooltipLayer',
  props: {
    indicator: { type: Object as PropType<IndicatorMeta>, required: true },
    color: { type: Function as PropType<(year: number) => string>, required: true },
    city: { type: Object as PropType<City>, required: true },
    cities: { type: Array as PropType<readonly City[]>, required: true },
    comparison: { type: Array as PropType<readonly Comparison[]>, required: true },
    activeYear: { type: Number as PropType<number | null>, default: null },
    legend: { type: Object as PropType<Readonly<Record<string, boolean>>>, required: true }
  },
  emits: {
    keepOpen: () => true,
    leave: () => true
  },
  setup(props, { emit }) {
    return () => (
      <div
        class={styles.tooltip}
        data-dashboard-tooltip
        onPointerenter={() => emit('keepOpen')}
        onPointerleave={() => emit('leave')}
      >
        <TooltipTable
          indicator={props.indicator}
          color={props.color}
          city={props.city}
          cities={props.cities}
          comparison={props.comparison}
          activeYear={props.activeYear}
          legend={props.legend}
        />
      </div>
    );
  }
});
