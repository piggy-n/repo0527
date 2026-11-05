import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { flowCamera, type FlowView } from '../flow/camera';
import type { FlowFrame, NodeFrame } from '../flow/frame';
import { FLOW_COLUMNS, FLOW_LAYOUT, type FlowNode, type FlowPlan } from '../flow/plan';
import styles from './FlowChart.module.scss';

const { nodeWidth, nodeHeight, columnGap, padX } = FLOW_LAYOUT;
const HIDDEN: NodeFrame = { status: 'hidden', progress: 0 };
// 指标计算的节点（不含标准口径的对照）：完成后点了看这项指标的结果
const CALC_PREFIX = 'calc:';
const pickedIndicator = (node: FlowNode) =>
  node.step === 'compute' && node.kind === 'node' ? node.key.slice(CALC_PREFIX.length) : null;

// 连线：从上一个节点的右边到下一个节点的左边，水平进出
function curve(a: FlowNode, b: FlowNode): string {
  const x1 = a.x + nodeWidth;
  const y1 = a.y + nodeHeight / 2;
  const x2 = b.x;
  const y2 = b.y + nodeHeight / 2;
  const dx = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

/**
 * 推演流程图：节点从父节点处长出，连线先描出再有光点流向正在执行的节点；镜头跟随正在执行的一列，
 * 也可以看全览或拖动画布。节点状态由 flowFrame 按推演进度算出，组件只画；完成后指标计算的节点可以点
 */
export const FlowChart = defineComponent({
  name: 'FlowChart',
  props: {
    plan: { type: Object as PropType<FlowPlan>, required: true },
    frame: { type: Object as PropType<FlowFrame>, required: true },
    paused: Boolean,
    /** 计算完成：看全览，指标计算的节点可以点 */
    done: Boolean,
    /** 时间线上悬停的一步：这一列的节点高亮 */
    highlight: { type: Number as PropType<number | null>, default: null },
    /** 右边被浮层（人工干预）挡住的宽度：镜头只用左边的部分 */
    reserveRight: { type: Number, default: 0 }
  },
  emits: {
    /** 完成后点了指标计算的节点：看这项指标的结果 */
    pick: (indicatorId: string) => typeof indicatorId === 'string'
  },
  setup(props, { emit }) {
    const canvas = ref<HTMLElement>();
    const size = useShownElementSize(canvas);
    const view = ref<FlowView | 'free'>('follow');
    // 拖动画布时的位置；跟随、全览时由 flowCamera 算
    const free = ref({ x: 0, y: 0, scale: 1 });
    const drag = ref<{ x: number; y: number; from: { x: number; y: number; scale: number } } | null>(null);

    // 完成时看全览，重算开始时回到跟随
    watch(
      () => props.done,
      done => (view.value = done ? 'overview' : 'follow')
    );

    const camera = computed(() => {
      if (view.value === 'free') {
        return free.value;
      }
      const viewport = {
        width: Math.max(0, size.width.value - props.reserveRight),
        height: size.height.value,
        bottom: 0
      };
      return flowCamera(props.plan, props.frame, viewport, view.value);
    });

    const nodeFrame = (key: string) => props.frame.nodes.get(key) ?? HIDDEN;
    const visible = (key: string) => nodeFrame(key).status !== 'hidden';

    const onPointerdown = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) {
        return;
      }
      drag.value = { x: event.clientX, y: event.clientY, from: camera.value };
      canvas.value?.setPointerCapture(event.pointerId);
    };
    const onPointermove = (event: PointerEvent) => {
      const current = drag.value;
      if (!current) {
        return;
      }
      view.value = 'free';
      free.value = {
        ...current.from,
        x: current.from.x + event.clientX - current.x,
        y: current.from.y + event.clientY - current.y
      };
    };
    const endDrag = () => {
      drag.value = null;
    };

    const renderNode = (node: FlowNode) => {
      const frame = nodeFrame(node.key);
      // 从第一个已经出现的父节点处长出来
      const parent = props.plan.edges
        .filter(([, to]) => to === node.key)
        .map(([from]) => props.plan.nodes.find(item => item.key === from))
        .find(item => item && visible(item.key));
      const lit = props.highlight === null || props.highlight === node.column;
      const picked = pickedIndicator(node);
      return (
        <div
          key={node.key}
          class={[
            styles.node,
            styles[frame.status],
            node.kind === 'root' && styles.root,
            node.kind === 'standard' && styles.standard,
            !lit && styles.dim
          ]}
          data-node={node.key}
          data-status={frame.status}
          style={{
            left: `${node.x}px`,
            top: `${node.y}px`,
            width: `${nodeWidth}px`,
            height: `${nodeHeight}px`,
            '--dx': `${parent ? parent.x - node.x : -40}px`,
            '--dy': `${parent ? parent.y - node.y : 0}px`,
            '--progress': frame.progress.toFixed(3)
          }}
        >
          <div class={styles.head}>
            <span class={styles.label}>{node.label}</span>
            {node.scenario && <span class={styles.scenario}>自定义口径</span>}
            <span class={styles.state}>
              {frame.status === 'running' && <span class={styles.spinner} />}
              {frame.status === 'done' && <SvgIcon class={styles.check} name="check" />}
              {frame.status === 'stale' && <span class={styles.staleText}>待更新</span>}
            </span>
          </div>
          <b class={styles.title} title={node.title}>
            {node.title}
          </b>
          <span class={styles.detail} title={node.detail}>
            {node.detail}
          </span>
          <i class={styles.progress} />
          {props.done && picked !== null && (
            <button
              type="button"
              class={styles.pick}
              aria-label={`看${node.label}的结果`}
              onClick={() => emit('pick', picked)}
            />
          )}
        </div>
      );
    };

    // 两端都出现了的连线，以及它流向的节点状态
    const shownLinks = computed(() => {
      const byKey = new Map(props.plan.nodes.map(node => [node.key, node]));
      return props.plan.edges.flatMap(([from, to]) => {
        const a = byKey.get(from);
        const b = byKey.get(to);
        if (!a || !b || !visible(from) || !visible(to)) {
          return [];
        }
        const target = nodeFrame(to).status;
        const stale = target === 'stale' || nodeFrame(from).status === 'stale';
        const state = target === 'running' ? 'active' : stale ? 'stale' : 'done';
        return [{ key: `${from}>${to}`, d: curve(a, b), state, standard: b.kind === 'standard' }];
      });
    });

    const renderLinks = () =>
      shownLinks.value.map(link => (
        <g
          key={link.key}
          class={[
            styles.link,
            link.state === 'active' && styles.active,
            link.state === 'stale' && styles.stale,
            link.standard && styles.standardLink
          ]}
        >
          <path class={styles.line} d={link.d} pathLength={1} />
          <path class={styles.flow} d={link.d} />
        </g>
      ));

    // 流向正在执行的节点的光点：沿连线跑（CSS 运动路径）
    const renderSparks = () =>
      shownLinks.value
        .filter(link => link.state === 'active')
        .map(link => <i key={link.key} class={styles.spark} style={{ offsetPath: `path('${link.d}')` }} />);

    return () => {
      const { plan, frame } = props;
      const { x, y, scale } = camera.value;
      return (
        <div
          ref={canvas}
          class={[styles.canvas, props.paused && styles.paused, drag.value && styles.dragging]}
          onPointerdown={onPointerdown}
          onPointermove={onPointermove}
          onPointerup={endDrag}
          onPointercancel={endDrag}
        >
          <div
            class={[styles.world, !drag.value && styles.animate]}
            style={{
              width: `${plan.width}px`,
              height: `${plan.height}px`,
              transform: `translate(${x}px, ${y}px) scale(${scale})`
            }}
          >
            {FLOW_COLUMNS.map((title, column) => (
              <span
                key={title}
                class={[
                  styles.columnHead,
                  frame.column === column && styles.current,
                  (frame.column === null || column < frame.column) && styles.passed
                ]}
                style={{ left: `${padX + column * (nodeWidth + columnGap)}px`, width: `${nodeWidth}px` }}
              >
                {title}
              </span>
            ))}
            <svg class={styles.links} width={plan.width} height={plan.height} aria-hidden="true">
              {renderLinks()}
            </svg>
            {renderSparks()}
            {plan.nodes.filter(node => visible(node.key)).map(renderNode)}
          </div>
          <div class={styles.views} role="group" aria-label="流程图的视图">
            {(['follow', 'overview'] as const).map(item => (
              <button key={item} type="button" aria-pressed={view.value === item} onClick={() => (view.value = item)}>
                {item === 'follow' ? '跟随' : '全览'}
              </button>
            ))}
          </div>
        </div>
      );
    };
  }
});
