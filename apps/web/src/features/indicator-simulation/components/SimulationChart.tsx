import { useResizeObserver } from '@vueuse/core';
import type { ECharts } from 'echarts/core';
import { defineComponent, onBeforeUnmount, onMounted, type PropType, ref, watch } from 'vue';
import { createChart } from '../result/chart-runtime';
import type { SimulationChartOption } from '../result/chart-options';

/** 结果面板的图表：跟随容器尺寸重绘，配置变了整体替换 */
export const SimulationChart = defineComponent({
  name: 'SimulationChart',
  props: {
    option: { type: Object as PropType<SimulationChartOption>, required: true },
    height: { type: Number, required: true },
    label: { type: String, required: true }
  },
  setup(props) {
    const container = ref<HTMLDivElement>();
    let instance: ECharts | null = null;

    onMounted(() => {
      if (container.value) {
        instance = createChart(container.value);
        instance.setOption(props.option);
      }
    });
    watch(
      () => props.option,
      option => instance?.setOption(option, { notMerge: true })
    );
    useResizeObserver(container, () => instance?.resize());
    onBeforeUnmount(() => {
      instance?.dispose();
      instance = null;
    });

    return () => <div ref={container} style={{ height: `${props.height}px` }} role="img" aria-label={props.label} />;
  }
});
