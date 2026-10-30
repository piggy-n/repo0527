import { ArrowRight } from '@element-plus/icons-vue';
import { useResizeObserver } from '@vueuse/core';
import { ElCheckTag, ElIcon, ElTag, ElTooltip } from 'element-plus';
import { computed, defineComponent, nextTick, onMounted, type PropType, ref, shallowRef, watch } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { RelationGraphOwner } from '../composables/useRelationGraph';
import { type CardBox, edgeShapes } from '../extraction/relation-geometry';
import { RELATION_KINDS, type RelationKind, type RelationNode } from '../extraction/relation-graph';
import { productColor, RELATION_KIND_STYLES } from '../extraction/relation-style';
import type { RelationLane, RelationTreeItem } from '../extraction/relation-view';
import styles from './RelationGraph.module.scss';
import { RelationKindSample } from './RelationKindSample';

// 泳道最窄 200、间隔 40；舞台左右内边距共 48（右边 32，留给最后一列的时序弧线）。样式从这里取，不在 SCSS 里另写
const LANE_MIN_WIDTH = 200;
const LANE_GAP = 40;
const STAGE_PADDING_X = 48;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 1.25;
// 按下后移动超过这个距离才算拖动画布
const PAN_THRESHOLD = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface Pan {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

// 元素在舞台里的位置：沿 offsetParent 累加，不受舞台缩放的 transform 影响
function offsetIn(element: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: Element | null = element;
  while (current instanceof HTMLElement && current !== root) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent;
  }
  return { x, y };
}

// 把命中的部分包进 <mark>，忽略大小写
function highlight(text: string, keyword: string) {
  const key = keyword.toLowerCase();
  const at = key ? text.toLowerCase().indexOf(key) : -1;
  if (at < 0) {
    return text;
  }
  return [text.slice(0, at), <mark key="match">{text.slice(at, at + key.length)}</mark>, text.slice(at + key.length)];
}

// 视角按钮只有图标，悬停在上方提示名称
function toolButton(label: string, icon: IconName, action: () => void) {
  return (
    <ElTooltip {...MAP_TOOLTIP_PROPS} content={label} placement="top">
      <button type="button" class={styles.tool} aria-label={label} onClick={action}>
        <SvgIcon name={icon} size={18} />
      </button>
    </ElTooltip>
  );
}

/**
 * 自助取数的水资源关系图：每个数据成果一条泳道，分类按层级缩进，数据表在泳道底部，关系画成泳道之间的线。
 * 悬停或键盘聚焦时突出相关的节点和线，点击选中；拖动空白处平移，Ctrl + 滚轮和右下角按钮缩放
 */
export const RelationGraph = defineComponent({
  name: 'RelationGraph',
  props: {
    owner: { type: Object as PropType<RelationGraphOwner>, required: true }
  },
  setup(props) {
    const owner = props.owner;
    const view = owner.view;
    const viewport = ref<HTMLElement>();
    const stage = ref<HTMLElement>();
    const boxes = shallowRef<ReadonlyMap<string, CardBox>>(new Map());
    const stageSize = shallowRef({ width: 0, height: 0 });
    const viewportWidth = ref(0);
    const zoom = ref(1);
    const hoverId = ref<string | null>(null);
    const panning = ref(false);
    let pan: Pan | null = null;

    const minStageWidth = computed(() => {
      const count = view.value.lanes.length;
      return count * LANE_MIN_WIDTH + Math.max(0, count - 1) * LANE_GAP + STAGE_PADDING_X;
    });
    // 缩小时舞台加宽，泳道最宽 300，多出来的居中
    const stageWidth = computed(() => Math.max(minStageWidth.value, Math.floor(viewportWidth.value / zoom.value)));
    const selectedCard = computed(() =>
      owner.selectedId.value === null ? null : (view.value.representatives.get(owner.selectedId.value) ?? null)
    );
    // 焦点：悬停或键盘聚焦的卡片优先，其次是选中的卡片
    const focus = computed(() =>
      hoverId.value !== null && view.value.laneOf.has(hoverId.value) ? hoverId.value : selectedCard.value
    );
    const relatedKinds = computed(() => {
      const kinds = new Map<string, RelationKind>();
      for (const edge of view.value.edges) {
        if (edge.from === focus.value) {
          kinds.set(edge.to, edge.kind);
        } else if (edge.to === focus.value) {
          kinds.set(edge.from, edge.kind);
        }
      }
      return kinds;
    });
    const shapes = computed(() => edgeShapes(view.value.edges, boxes.value, view.value.laneOf, focus.value));
    const availableKinds = computed(() => new Set(owner.graph.relations.map(relation => relation.kind)));

    function measure() {
      const root = stage.value;
      if (!root) {
        return;
      }
      const next = new Map<string, CardBox>();
      for (const element of root.querySelectorAll<HTMLElement>('[data-node-id]')) {
        const id = element.dataset.nodeId;
        if (id) {
          next.set(id, { ...offsetIn(element, root), width: element.offsetWidth, height: element.offsetHeight });
        }
      }
      boxes.value = next;
      stageSize.value = { width: root.offsetWidth, height: root.offsetHeight };
    }

    onMounted(measure);
    watch([view, stageWidth], measure, { flush: 'post' });
    useResizeObserver(viewport, () => {
      viewportWidth.value = viewport.value?.clientWidth ?? 0;
    });
    useResizeObserver(stage, measure);

    // 缩放时保持视口里的某一点不动，默认是视口中心
    function setZoom(value: number, origin?: { x: number; y: number }) {
      const element = viewport.value;
      const previous = zoom.value;
      const next = clamp(Math.round(value * 100) / 100, ZOOM_MIN, ZOOM_MAX);
      if (!element || next === previous) {
        return;
      }
      const ox = origin?.x ?? element.clientWidth / 2;
      const oy = origin?.y ?? element.clientHeight / 2;
      const cx = (element.scrollLeft + ox) / previous;
      const cy = (element.scrollTop + oy) / previous;
      zoom.value = next;
      void nextTick(() => {
        element.scrollLeft = cx * next - ox;
        element.scrollTop = cy * next - oy;
      });
    }

    // 适配全图：泳道按最窄宽度排下、整体高度放进视口；不放大
    function fit() {
      const element = viewport.value;
      if (!element) {
        return;
      }
      const height = Math.max(1, stageSize.value.height);
      const scale = Math.min(1, element.clientWidth / minStageWidth.value, element.clientHeight / height);
      zoom.value = clamp(Math.floor(scale * 100) / 100, ZOOM_MIN, 1);
      void nextTick(() => {
        element.scrollLeft = 0;
        element.scrollTop = 0;
      });
    }

    function onWheel(event: WheelEvent) {
      const element = viewport.value;
      if (!event.ctrlKey || !element) {
        return;
      }
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setZoom(zoom.value * (event.deltaY < 0 ? 1.1 : 1 / 1.1), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });
    }

    // 按住空白处拖动画布；按在卡片、按钮上不拖
    function onPointerDown(event: PointerEvent) {
      const element = viewport.value;
      if (!element || event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) {
        return;
      }
      pan = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop
      };
      element.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      const element = viewport.value;
      if (!pan || !element || event.pointerId !== pan.pointerId) {
        return;
      }
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      if (!panning.value && Math.hypot(dx, dy) < PAN_THRESHOLD) {
        return;
      }
      panning.value = true;
      element.scrollLeft = pan.left - dx;
      element.scrollTop = pan.top - dy;
    }

    function onPointerUp(event: PointerEvent) {
      if (pan?.pointerId === event.pointerId) {
        pan = null;
        panning.value = false;
      }
    }

    // 键盘聚焦和悬停一样突出相关的节点；鼠标点击产生的焦点不算
    function onCardFocus(event: FocusEvent, id: string) {
      if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) {
        hoverId.value = id;
      }
    }

    function cardLabel(node: RelationNode, collapsedCount: number): string {
      const parts = [`${node.code} ${node.name}`];
      if (collapsedCount > 0) {
        parts.push(`已收起 ${collapsedCount} 个下级`);
      }
      const kind = relatedKinds.value.get(node.id);
      if (kind) {
        parts.push(`与当前节点${RELATION_KIND_STYLES[kind].label}`);
      }
      return parts.join('，');
    }

    function renderCard(node: RelationNode, collapsedCount: number) {
      const selected = selectedCard.value === node.id;
      const kind = relatedKinds.value.get(node.id);
      const keyword = view.value.matches.has(node.id) ? owner.keyword.value : '';
      const fields = node.table?.fields;
      return (
        <button
          type="button"
          class={[
            styles.card,
            node.level === 1 && styles.levelOne,
            node.level === null && styles.dataset,
            kind && !selected && styles.related,
            selected && styles.selected
          ]}
          style={kind ? { '--relation-color': RELATION_KIND_STYLES[kind].color } : undefined}
          data-node-id={node.id}
          aria-pressed={selected}
          aria-label={cardLabel(node, collapsedCount)}
          onClick={() => owner.select(node.id)}
          onMouseenter={() => (hoverId.value = node.id)}
          onMouseleave={() => (hoverId.value = null)}
          onFocus={(event: FocusEvent) => onCardFocus(event, node.id)}
          onBlur={() => (hoverId.value = null)}
        >
          {node.table && <SvgIcon key="table" class={styles.tableMark} name="data-table" size={12} />}
          <span key="code" class={styles.code}>
            {highlight(node.code, keyword)}
          </span>
          <span key="name" class={styles.name}>
            {highlight(node.name, keyword)}
          </span>
          {node.level === null && (
            <span key="fields" class={[styles.badge, !fields && styles.pending]}>
              {fields ? `字段 ${fields.length}` : '待补充'}
            </span>
          )}
          {collapsedCount > 0 && (
            <span key="count" class={styles.count} aria-hidden="true">
              {collapsedCount}
            </span>
          )}
        </button>
      );
    }

    // toggles：没有下级的节点也留出按钮的位置。一级类只在同级里有能展开的节点时留，名称对齐；
    // 下级一直留，卡片比上级的卡片缩进一个按钮加间距，二级类、三级类逐级往右（2026-10-30）
    function renderItem(item: RelationTreeItem, toggles: boolean) {
      const children = item.children;
      return (
        <div key={item.node.id} class={styles.item}>
          <div class={styles.row}>
            {item.childCount > 0 ? (
              <button
                type="button"
                class={styles.toggle}
                aria-expanded={item.open}
                aria-label={`${item.open ? '收起' : '展开'} ${item.node.name}`}
                onClick={() => owner.toggleExpanded(item.node.id)}
              >
                <ElIcon>
                  <ArrowRight />
                </ElIcon>
              </button>
            ) : (
              toggles && <span class={styles.toggleSpace} aria-hidden="true" />
            )}
            {renderCard(item.node, item.open ? 0 : item.childCount)}
          </div>
          {children.length > 0 && (
            <div class={styles.children}>
              {children.map(child => renderItem(child, true))}
            </div>
          )}
        </div>
      );
    }

    function renderLane(lane: RelationLane) {
      const summary = [lane.product.kind, `${lane.classCount} 个分类`];
      if (lane.datasets.length > 0) {
        summary.push(`${lane.datasets.length} 张表`);
      }
      return (
        <section
          key={lane.product.id}
          class={styles.lane}
          style={{ '--product-color': productColor(lane.productIndex) }}
          aria-label={lane.product.name}
        >
          <header class={styles.laneHead}>
            <strong>{lane.product.name}</strong>
            <span>{summary.join(' · ')}</span>
          </header>
          <div class={styles.laneBody}>
            {lane.tree.map(item => renderItem(item, lane.tree.some(other => other.childCount > 0)))}
            {lane.datasets.length > 0 && (
              <div class={styles.datasets}>
                <div class={styles.subhead}>数据表</div>
                {lane.datasets.map(node => (
                  <div key={node.id} class={styles.item}>
                    <div class={styles.row}>{renderCard(node, 0)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      );
    }

    function renderToolbar() {
      return (
        <div class={styles.toolbar}>
          <div class={styles.products} role="group" aria-label="数据成果">
            <span class={styles.label}>数据成果</span>
            {owner.graph.products.map((product, index) => (
              <ElCheckTag
                key={product.id}
                class={styles.productTag}
                checked={!owner.hiddenProducts.value.has(product.id)}
                onChange={() => owner.toggleProduct(product.id)}
              >
                <span class={styles.dot} style={{ backgroundColor: productColor(index) }} />
                {product.name}
              </ElCheckTag>
            ))}
          </div>
          {owner.keyword.value && (
            <ElTag class={styles.keyword} closable onClose={owner.clearKeyword}>
              检索：{owner.keyword.value} · 命中 {view.value.matches.size}
            </ElTag>
          )}
        </div>
      );
    }

    function renderStage() {
      const { width, height } = stageSize.value;
      return (
        <div class={styles.sizer} style={{ width: `${width * zoom.value}px`, height: `${height * zoom.value}px` }}>
          <div
            ref={stage}
            class={styles.stage}
            style={{
              width: `${stageWidth.value}px`,
              transform: `scale(${zoom.value})`,
              '--lane-gap': `${LANE_GAP}px`,
              '--lane-min-width': `${LANE_MIN_WIDTH}px`
            }}
          >
            <svg class={styles.edges} width={width} height={height} aria-hidden="true">
              {shapes.value.map(shape => {
                const style = RELATION_KIND_STYLES[shape.kind];
                return (
                  <path
                    key={shape.key}
                    d={shape.path}
                    fill="none"
                    stroke={style.color}
                    stroke-width={(shape.focused ? 2.5 : 1.5) + Math.min(shape.count - 1, 3) * 0.5}
                    stroke-dasharray={style.dash ?? undefined}
                    stroke-linecap="round"
                    opacity={focus.value !== null && !shape.focused ? 0.18 : 1}
                  />
                );
              })}
            </svg>
            {view.value.lanes.map(renderLane)}
            {shapes.value
              .filter(shape => shape.focused)
              .map(shape => {
                const style = RELATION_KIND_STYLES[shape.kind];
                return (
                  <span
                    key={`label-${shape.key}`}
                    class={styles.edgeLabel}
                    style={{ left: `${shape.label.x}px`, top: `${shape.label.y}px`, color: style.color }}
                  >
                    {shape.count > 1 ? `${style.label} ×${shape.count}` : style.label}
                  </span>
                );
              })}
          </div>
        </div>
      );
    }

    function renderLegend() {
      return (
        <div class={styles.legend}>
          <div class={styles.kinds} role="group" aria-label="关系类型">
            {RELATION_KINDS.map(kind => {
              const style = RELATION_KIND_STYLES[kind];
              const available = availableKinds.value.has(kind);
              const shown = available && owner.kinds.value.has(kind);
              return (
                <ElTooltip
                  key={kind}
                  {...MAP_TOOLTIP_PROPS}
                  content={available ? style.description : `${style.description}（暂无关系数据）`}
                  placement="top"
                >
                  <button
                    type="button"
                    class={[styles.kind, !shown && styles.kindOff]}
                    aria-pressed={shown}
                    aria-disabled={!available}
                    onClick={() => available && owner.toggleKind(kind)}
                  >
                    <RelationKindSample kind={kind} />
                    <span>{style.label}</span>
                    <span class={styles.kindCount}>{available ? view.value.counts[kind] : '待补充'}</span>
                  </button>
                </ElTooltip>
              );
            })}
          </div>
          <div class={styles.tools} role="toolbar" aria-label="关系图视角">
            {toolButton('缩小', 'map-zoom-out', () => setZoom(zoom.value / ZOOM_STEP))}
            <ElTooltip {...MAP_TOOLTIP_PROPS} content="恢复 100%" placement="top">
              <button
                type="button"
                class={[styles.tool, styles.zoomValue]}
                aria-label="恢复 100%"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom.value * 100)}%
              </button>
            </ElTooltip>
            {toolButton('放大', 'map-zoom-in', () => setZoom(zoom.value * ZOOM_STEP))}
            {toolButton('适配全图', 'dashboard-expand', fit)}
          </div>
        </div>
      );
    }

    return () => (
      <div class={styles.root}>
        {renderToolbar()}
        <div class={styles.canvas}>
          <div
            ref={viewport}
            class={[styles.viewport, panning.value && styles.panning]}
            role="group"
            aria-label="水资源关系图"
            onWheel={onWheel}
            onPointerdown={onPointerDown}
            onPointermove={onPointerMove}
            onPointerup={onPointerUp}
            onPointercancel={onPointerUp}
          >
            {renderStage()}
            {view.value.lanes.length === 0 && <div class={styles.empty}>请在上方至少勾选一个数据成果</div>}
          </div>
        </div>
        {renderLegend()}
      </div>
    );
  }
});
