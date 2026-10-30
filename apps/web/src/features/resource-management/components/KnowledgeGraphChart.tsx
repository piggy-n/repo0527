import { useResizeObserver } from '@vueuse/core';
import type { ECElementEvent, ECharts } from 'echarts/core';
import { ElButton, ElTooltip } from 'element-plus';
import { defineComponent, nextTick, onMounted, onScopeDispose, type PropType, ref, watch } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { ChartTheme } from '../extraction/graph-chart';
import type * as GraphRuntime from '../extraction/graph-runtime';
import type { KnowledgeGraph, KnowledgeNode } from '../extraction/knowledge-graph';
import styles from './KnowledgeGraphChart.module.scss';

type LoadState = 'loading' | 'ready' | 'failed';

// 按钮每次缩放的倍数
const ZOOM_STEP = 1.25;

function readTheme(element: HTMLElement): ChartTheme {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    fontFamily: style.fontFamily,
    text: token('--color-text-strong'),
    textSecondary: token('--color-text-secondary'),
    background: token('--color-bg-container'),
    primary: token('--color-primary'),
    warning: token('--color-warning')
  };
}

/** 自助取数的关系图：ECharts 运行时在第一次显示时才加载；可拖动节点、拖动画布、滚轮和按钮缩放，点击节点选中 */
export const KnowledgeGraphChart = defineComponent({
  name: 'KnowledgeGraphChart',
  props: {
    graph: { type: Object as PropType<KnowledgeGraph>, required: true },
    keyword: { type: String, required: true },
    selectedId: String
  },
  emits: {
    select: (_node: KnowledgeNode) => true
  },
  setup(props, { emit }) {
    const host = ref<HTMLElement>();
    const state = ref<LoadState>('loading');
    let chart: ECharts | undefined;
    let runtime: typeof GraphRuntime | undefined;
    let disposed = false;

    function render() {
      const element = host.value;
      if (!chart || !runtime || !element) {
        return;
      }
      const viewport = { width: element.clientWidth, height: element.clientHeight };
      const option = runtime.knowledgeChartOption(props.graph, props.keyword, readTheme(element), viewport);
      chart.setOption(option, { notMerge: true });
      syncSelection();
    }

    // 选中状态以 selectedId 为准；ECharts 点击时自己会切换选中，之后再按 props 改回来
    function syncSelection() {
      if (!chart) {
        return;
      }
      chart.dispatchAction({ type: 'unselect', seriesIndex: 0, dataIndex: props.graph.nodes.map((_, index) => index) });
      const index = props.graph.nodes.findIndex(node => node.id === props.selectedId);
      if (index >= 0) {
        chart.dispatchAction({ type: 'select', seriesIndex: 0, dataIndex: index });
      }
    }

    function onClick(event: ECElementEvent) {
      if (event.dataType === 'node') {
        emit('select', props.graph.nodes[event.dataIndex]);
        void nextTick(syncSelection);
      }
    }

    async function load() {
      state.value = 'loading';
      try {
        const loaded = await import('../extraction/graph-runtime');
        // ECharts 只在排版时量一次文字宽度：先加载要用的两个字重，否则按后备字体量宽，换行、隐藏和图例翻页都会算错。
        // 页面上还没用到的字体不会自动加载，document.fonts.ready 等不到它；没有部署字体时这里直接完成
        const family = host.value ? getComputedStyle(host.value).fontFamily : '';
        await Promise.all([document.fonts.load(`400 12px ${family}`), document.fonts.load(`600 14px ${family}`)]);
        if (disposed || !host.value) {
          return;
        }
        runtime = loaded;
        chart = loaded.createChart(host.value);
        chart.on('click', onClick);
        render();
        state.value = 'ready';
      } catch {
        if (!disposed) {
          state.value = 'failed';
        }
      }
    }

    function zoomBy(ratio: number) {
      const element = host.value;
      chart?.dispatchAction({
        type: 'graphRoam',
        seriesIndex: 0,
        zoom: ratio,
        originX: (element?.clientWidth ?? 0) / 2,
        originY: (element?.clientHeight ?? 0) / 2
      });
    }

    // 回到适配全图的视角，拖动过的节点位置保留
    function reset() {
      chart?.setOption({ series: [{ zoom: 1, center: null }] });
    }

    onMounted(() => void load());
    useResizeObserver(host, () => chart?.resize());
    watch(() => [props.graph, props.keyword], render);
    watch(() => props.selectedId, syncSelection);
    onScopeDispose(() => {
      disposed = true;
      chart?.dispose();
      chart = undefined;
    });

    function renderState() {
      if (state.value === 'ready') {
        return null;
      }
      return (
        <div class={styles.state} role="status">
          {state.value === 'failed' ? '关系图加载失败' : '正在加载关系图…'}
          {state.value === 'failed' && (
            <ElButton link type="primary" onClick={() => void load()}>
              重试
            </ElButton>
          )}
        </div>
      );
    }

    // 只有图标，悬停在左边提示名称，和地图页的基础组一致
    function toolButton(label: string, icon: IconName, action: () => void) {
      return (
        <ElTooltip {...MAP_TOOLTIP_PROPS} content={label} placement="left">
          <button
            type="button"
            class={styles.tool}
            aria-label={label}
            disabled={state.value !== 'ready'}
            onClick={action}
          >
            <SvgIcon name={icon} size={20} />
          </button>
        </ElTooltip>
      );
    }

    return () => (
      <div class={styles.root}>
        <div ref={host} class={styles.canvas} role="img" aria-label="取数关系图" />
        {renderState()}
        <div class={styles.tools} role="toolbar" aria-label="关系图视角" aria-orientation="vertical">
          {toolButton('放大', 'map-zoom-in', () => zoomBy(ZOOM_STEP))}
          {toolButton('缩小', 'map-zoom-out', () => zoomBy(1 / ZOOM_STEP))}
          <div class={styles.separator} role="separator" />
          {toolButton('适配全图', 'dashboard-expand', reset)}
        </div>
      </div>
    );
  }
});
