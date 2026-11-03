import { useResizeObserver, useTimeoutFn } from '@vueuse/core';
import type { ECElementEvent, ECharts } from 'echarts/core';
import { ElButton, ElTooltip } from 'element-plus';
import { defineComponent, nextTick, onMounted, onScopeDispose, type PropType, ref, watch } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { ChartTheme, GraphDisplay } from '../extraction/graph-chart';
import type { GraphLayoutInput, GraphPoint, GraphView, GraphViewport } from '../extraction/graph-model';
import type * as GraphRuntime from '../extraction/graph-runtime';
import styles from './KnowledgeGraphChart.module.scss';

type LoadState = 'loading' | 'ready' | 'failed';

// 按钮每次缩放的倍数
const ZOOM_STEP = 1.25;
// 画布尺寸稳定后才重新布局，拖动窗口时不反复计算
const RELAYOUT_DELAY = 120;

function readTheme(element: HTMLElement): ChartTheme {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    fontFamily: style.fontFamily,
    background: token('--color-bg-container'),
    primary: token('--color-primary'),
    tooltipBackground: token('--color-text-title'),
    tooltipText: token('--color-text-inverse')
  };
}

// 当前缩放比例：数据单位到像素的比例除以缩放为 1 时的比例；取三位小数，0.9999 这样的误差不能把字号算小一档
function currentZoom(chart: ECharts, baseScale: number): number {
  const origin = chart.convertToPixel({ seriesIndex: 0 }, [0, 0]);
  const unit = chart.convertToPixel({ seriesIndex: 0 }, [1, 0]);
  return Math.round(((unit[0] - origin[0]) / baseScale) * 1000) / 1000;
}

/**
 * 知识图谱的画布：ECharts 运行时在第一次显示时才加载；可拖动节点、拖动画布、滚轮和按钮缩放，点击选中，双击收起展开。
 * 名称写在节点里，字号跟节点在屏幕上的直径走（ADR 0126）：字号只取双数，缩放时跨档才更新标签
 */
export const KnowledgeGraphChart = defineComponent({
  name: 'KnowledgeGraphChart',
  props: {
    view: { type: Object as PropType<GraphView>, required: true },
    layoutInput: { type: Object as PropType<GraphLayoutInput>, required: true },
    selectedId: { type: String as PropType<string | null>, default: null },
    title: { type: String, default: '知识图谱' }
  },
  emits: {
    select: (_id: string) => true,
    toggle: (_id: string) => true
  },
  setup(props, { emit }) {
    const host = ref<HTMLElement>();
    const state = ref<LoadState>('loading');
    let chart: ECharts | undefined;
    let runtime: typeof GraphRuntime | undefined;
    let display: GraphDisplay | undefined;
    let labelKey = '';
    let renderedSize = '';
    let disposed = false;
    // 布局结果按输入和画布大小缓存；拖动过的节点位置 ECharts 不写回配置，更新标签时要带上，否则节点会跳回去
    const layouts = new Map<string, ReadonlyMap<string, GraphPoint>>();
    let positions: ReadonlyMap<string, GraphPoint> | undefined;
    const dragged = new Map<string, GraphPoint>();
    let grab: { id: string; dx: number; dy: number; startX: number; startY: number } | null = null;

    function layoutFor(viewport: GraphViewport, loaded: typeof GraphRuntime) {
      const key = `${props.layoutInput.key}@${viewport.width}x${viewport.height}`;
      const cached = layouts.get(key);
      if (cached) {
        return cached;
      }
      const result = loaded.layoutGraph(props.layoutInput, viewport);
      layouts.set(key, result);
      return result;
    }

    function render() {
      const element = host.value;
      if (!chart || !runtime || !element || element.clientWidth === 0 || element.clientHeight === 0) {
        return;
      }
      chart.resize();
      const viewport = { width: element.clientWidth, height: element.clientHeight };
      renderedSize = `${viewport.width}x${viewport.height}`;
      const layout = layoutFor(viewport, runtime);
      if (layout !== positions) {
        dragged.clear();
        positions = layout;
      }
      display = runtime.createGraphDisplay(props.view, layout, readTheme(element), viewport, dragged);
      chart.setOption(display.option, { notMerge: true });
      labelKey = display.labelKey(1);
      syncSelection();
    }

    // 字号或关系名称的位置变了才更新标签；只换 data、links，缩放和平移留在系列里
    function refreshLabels() {
      if (!chart || !display || !runtime) {
        return;
      }
      const zoom = currentZoom(chart, display.baseScale);
      const key = display.labelKey(zoom);
      if (key === labelKey) {
        return;
      }
      labelKey = key;
      chart.setOption(
        { series: [{ id: runtime.GRAPH_SERIES_ID, data: display.nodeItems(zoom), links: display.linkItems(zoom) }] },
        { lazyUpdate: true }
      );
      void nextTick(syncSelection);
    }

    // 选中状态以 selectedId 为准；ECharts 点击时自己会切换选中，之后再按 props 改回来
    function syncSelection() {
      if (!chart) {
        return;
      }
      chart.dispatchAction({ type: 'unselect', seriesIndex: 0, dataIndex: props.view.nodes.map((_, index) => index) });
      const index = props.view.nodes.findIndex(node => node.id === props.selectedId);
      if (index >= 0) {
        chart.dispatchAction({ type: 'select', seriesIndex: 0, dataIndex: index });
      }
    }

    function onClick(event: ECElementEvent) {
      if (event.dataType === 'node') {
        emit('select', props.view.nodes[event.dataIndex].id);
        void nextTick(syncSelection);
      }
    }

    function onDoubleClick(event: ECElementEvent) {
      if (event.dataType === 'node' && props.view.nodes[event.dataIndex].childCount > 0) {
        emit('toggle', props.view.nodes[event.dataIndex].id);
      }
    }

    // 按下时记住指针和节点中心的差，松开时换算回数据坐标，就是拖到的位置
    function onMouseDown(event: ECElementEvent) {
      const at = event.dataType === 'node' ? props.view.nodes[event.dataIndex].id : null;
      const point = at === null ? undefined : (dragged.get(at) ?? positions?.get(at));
      if (!chart || at === null || !point || !event.event) {
        return;
      }
      const { offsetX, offsetY } = event.event;
      const [x, y] = chart.convertFromPixel({ seriesIndex: 0 }, [offsetX, offsetY]);
      grab = { id: at, dx: x - point.x, dy: y - point.y, startX: offsetX, startY: offsetY };
    }

    function onMouseUp({ offsetX, offsetY }: { offsetX: number; offsetY: number }) {
      const released = grab;
      grab = null;
      if (!chart || !released || Math.hypot(offsetX - released.startX, offsetY - released.startY) <= 2) {
        return;
      }
      const [x, y] = chart.convertFromPixel({ seriesIndex: 0 }, [offsetX, offsetY]);
      dragged.set(released.id, { x: x - released.dx, y: y - released.dy });
      void nextTick(refreshLabels);
    }

    async function load() {
      state.value = 'loading';
      try {
        const loaded = await import('../extraction/graph-runtime');
        // ECharts 只在排版时量一次文字宽度：先加载要用的两个字重，否则按后备字体量宽。
        // 页面上还没用到的字体不会自动加载，document.fonts.ready 等不到它；没有部署字体时这里直接完成
        const family = host.value ? getComputedStyle(host.value).fontFamily : '';
        await Promise.all([document.fonts.load(`400 12px ${family}`), document.fonts.load(`600 14px ${family}`)]);
        if (disposed || !host.value) {
          return;
        }
        runtime = loaded;
        chart = loaded.createChart(host.value);
        chart.on('click', onClick);
        chart.on('dblclick', onDoubleClick);
        chart.on('mousedown', onMouseDown);
        chart.on('graphroam', refreshLabels);
        chart.getZr().on('mouseup', onMouseUp);
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
      if (chart && runtime) {
        chart.setOption({ series: [{ id: runtime.GRAPH_SERIES_ID, zoom: 1, center: null }] });
        refreshLabels();
      }
    }

    // 尺寸真的变了才重新布局：重画会回到适配全图，观察器第一次回调时尺寸没变，不能把用户刚做的缩放冲掉
    function renderIfResized() {
      const element = host.value;
      if (element && `${element.clientWidth}x${element.clientHeight}` !== renderedSize) {
        render();
      }
    }

    // 再次开始时重新计时；作用域销毁时自动停止
    const { start: scheduleRender } = useTimeoutFn(renderIfResized, RELAYOUT_DELAY, { immediate: false });

    onMounted(() => void load());
    useResizeObserver(host, () => {
      chart?.resize();
      scheduleRender();
    });
    watch(() => [props.view, props.layoutInput], render);
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
          {state.value === 'failed' ? '知识图谱加载失败' : '正在加载知识图谱…'}
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
        <div ref={host} class={styles.canvas} role="img" aria-label={props.title} />
        {renderState()}
        <div class={styles.tools} role="toolbar" aria-label="视角" aria-orientation="vertical">
          {toolButton('放大', 'map-zoom-in', () => zoomBy(ZOOM_STEP))}
          {toolButton('缩小', 'map-zoom-out', () => zoomBy(1 / ZOOM_STEP))}
          <div class={styles.separator} role="separator" />
          {toolButton('适配全图', 'dashboard-expand', reset)}
        </div>
      </div>
    );
  }
});
