import { defineComponent, onMounted, onScopeDispose, ref, watch, type PropType } from 'vue';
import { useDocumentVisibility, useIntersectionObserver, useResizeObserver } from '@vueuse/core';
import { createChart } from '../charts/runtime';
import type { DashboardChartOption } from '../charts/options';
import type { City } from '../model';
import { useChartFonts } from '../composables/useChartFonts';
import styles from './DashboardCharts.module.scss';

/** 第三方事件在边界收窄，避免将宽泛的 ECharts 事件类型传入业务状态 */
function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export const DashboardPlot = defineComponent({
  name: 'DashboardPlot',
  props: {
    option: { type: Object as PropType<DashboardChartOption>, required: true },
    cities: { type: Array as PropType<readonly City[]>, required: true },
    description: { type: String, required: true },
    active: { type: Boolean, default: true },
    retain: { type: Boolean, default: false }
  },
  emits: {
    hover: (_code: string | null) => true,
    legend: (_selected: Readonly<Record<string, boolean>>) => true
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    const visible = ref(false);
    const pageVisibility = useDocumentVisibility();
    const fontRevision = useChartFonts();
    let chart: ReturnType<typeof createChart> | undefined;
    let mounted = false;
    let rendered = false;
    let keyboardCity = -1;
    useIntersectionObserver(
      element,
      entries => {
        visible.value = entries.some(entry => entry.isIntersecting);
      },
      { rootMargin: '120px 0px' }
    );

    function hide(): void {
      chart?.dispatchAction({ type: 'hideTip' });
      emit('hover', null);
    }

    function release(): void {
      chart?.dispose();
      chart = undefined;
      hide();
    }

    function update(): void {
      const target = element.value;
      if (!mounted || !target || !props.active || pageVisibility.value === 'hidden') {
        release();
        return;
      }
      if (!visible.value) {
        if (!props.retain) {
          release();
        }
        return;
      }
      // 隐藏后的零尺寸不传给引擎，恢复时以真实容器重新初始化
      if (target.clientWidth <= 0 || target.clientHeight <= 0) {
        return;
      }
      if (!chart) {
        chart = createChart(target, undefined, { devicePixelRatio: Math.min(devicePixelRatio || 1, 2) });
        chart.on('updateAxisPointer', (event: unknown) => {
          const axes = objectValue(event)?.axesInfo;
          if (!Array.isArray(axes)) {
            return;
          }
          const value = objectValue(axes[0])?.value;
          if (typeof value === 'number') {
            emit('hover', props.cities[value]?.code ?? null);
          }
        });
        chart.on('legendselectchanged', (event: unknown) => {
          const selected = objectValue(objectValue(event)?.selected);
          if (selected) {
            const entries = Object.entries(selected).filter(
              (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
            );
            emit('legend', Object.fromEntries(entries));
          }
          hide();
        });
        chart.getZr().on('globalout', hide);
      }
      chart.resize();
      const option: DashboardChartOption = { ...props.option };
      if (rendered) {
        option.animationDuration = 0;
      }
      chart.setOption(option, { notMerge: true });
      rendered = true;
    }

    useResizeObserver(element, update);
    watch(
      [() => props.option, () => props.active, () => props.retain, visible, pageVisibility, fontRevision],
      update,
      { flush: 'post' }
    );
    onMounted(() => {
      mounted = true;
      update();
    });
    onScopeDispose(() => {
      mounted = false;
      release();
    });

    function onKeydown(event: KeyboardEvent): void {
      if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      if (event.key === 'Escape') {
        hide();
        return;
      }
      const step = event.key === 'ArrowRight' ? 1 : -1;
      keyboardCity = Math.max(0, Math.min(props.cities.length - 1, keyboardCity + step));
      chart?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: keyboardCity });
      emit('hover', props.cities[keyboardCity]?.code ?? null);
    }

    return () => (
      <div
        ref={element}
        class={styles.plot}
        tabindex={0}
        role="img"
        aria-label={`${props.description}，左右键查看城市数值，Esc 关闭提示`}
        onKeydown={onKeydown}
        onBlur={hide}
      />
    );
  }
});
