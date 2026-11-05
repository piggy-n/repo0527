import { useResizeObserver } from '@vueuse/core';
import type { ECharts } from 'echarts/core';
import { defineComponent, onBeforeUnmount, onMounted, type PropType, ref, watch } from 'vue';
import type { ChatChart } from '../chat-result';
import { chartOption } from '../chart-option';
import { createChart } from '../chart-runtime';
import styles from './ResultChart.module.scss';

/** 回答的图表：跟随容器尺寸重绘，换了数据时整体替换配置 */
export const ResultChart = defineComponent({
  name: 'ResultChart',
  props: {
    chart: { type: Object as PropType<ChatChart>, required: true }
  },
  setup(props) {
    const container = ref<HTMLDivElement>();
    let instance: ECharts | null = null;

    onMounted(() => {
      if (container.value) {
        instance = createChart(container.value);
        instance.setOption(chartOption(props.chart));
      }
    });
    watch(
      () => props.chart,
      chart => instance?.setOption(chartOption(chart), { notMerge: true })
    );
    useResizeObserver(container, () => instance?.resize());
    onBeforeUnmount(() => {
      instance?.dispose();
      instance = null;
    });

    return () => <div ref={container} class={styles.root} role="img" aria-label={props.chart.title || '图表'} />;
  }
});
