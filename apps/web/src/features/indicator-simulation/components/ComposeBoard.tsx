import { VideoPlay } from '@element-plus/icons-vue';
import { useResizeObserver } from '@vueuse/core';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElPopover } from 'element-plus';
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  type PropType,
  ref,
  shallowRef,
  TransitionGroup,
  type VNodeChild,
  watch
} from 'vue';
import { ChatAvatar } from '@/shared/chat-avatar/ChatAvatar';
import { usePageActive } from '@/shared/composables/usePageActive';
import { useSortableList } from '@/shared/composables/useSortableList';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import { districtsOf, JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import {
  boardLinks,
  type BoardLane,
  type Box,
  indicatorNode,
  isLit,
  OUTPUT_NODE,
  paramNode,
  REGION_NODE,
  relatedNodes,
  yearNode
} from '../compose/board';
import { CONDITION_LABELS, missingConditions } from '../compose/composition';
import type { CompositionOwner } from '../composables/useComposition';
import type { ConditionDrag, DragItem } from '../composables/useConditionDrag';
import type { BuildState } from '../composables/usePromptComposer';
import type { SimulationModel } from '../composables/useSimulationModel';
import { reducedMotion } from '../motion';
import { STEP_GROUPS } from '../engine/steps';
import { reachText, simulationIndicator } from '../model/indicators';
import {
  describeParam,
  isScenario,
  isStandard,
  PARAM_LABELS,
  type ParamKey,
  paramsOf,
  type SimulationParams
} from '../model/params';
import styles from './ComposeBoard.module.scss';
import { EstimateBar } from './EstimateBar';
import { ParamPopover } from './ParamPopover';
import { StageStepper } from './StageStepper';

// 列标题的图标；AI计算是机器人头像（null）
const LANES: readonly { readonly id: BoardLane; readonly label: string; readonly icon: IconName | null }[] = [
  { id: 'years', label: '年份', icon: 'simulation-calendar' },
  { id: 'region', label: '监测范围', icon: 'simulation-region' },
  { id: 'indicators', label: '监测指标', icon: 'simulation-indicator' },
  { id: 'params', label: '计算参数', icon: 'simulation-tune' },
  { id: 'output', label: 'AI计算', icon: null }
];

// 节点移动、出现的动画时长（与样式一致），期间每帧重量位置，连线跟着节点走
const FOLLOW_MS = 400;
// 新连线从起点画到终点的时长（与样式一致）
const DRAW_MS = 600;
const ARROW_STEPS: Readonly<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1 };

function sameBoxes(a: ReadonlyMap<string, Box>, b: ReadonlyMap<string, Box>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, box] of b) {
    const other = a.get(key);
    if (!other || other.x !== box.x || other.y !== box.y || other.w !== box.w || other.h !== box.h) {
      return false;
    }
  }
  return true;
}

const removeButton = (label: string, onClick: () => void) => (
  <button type="button" class={styles.remove} aria-label={`移除${label}`} title="移除" onClick={onClick}>
    <SvgIcon name="close" />
  </button>
);

// 一列条件为空时的占位
const empty = (lane: 'years' | 'region' | 'indicators', show: boolean) =>
  show && (
    <div key="empty" class={styles.empty}>
      拖入或点选{CONDITION_LABELS[lane]}
    </div>
  );

/**
 * 编排图：年份 → 监测范围 → 监测指标 → 计算参数 → AI 推演五列，连线由节点位置算出；接收条件库的拖入，指标按手柄排序。
 * 计算参数只列所选指标用得上的几项；下方是指标预估，参数浮层打开时按草稿预览。
 * AI 按指令编排时只显示已经出现的节点，最新的一个闪一下并滚到看得见，新连线画出来，标题栏写 AI 在做的事
 */
export const ComposeBoard = defineComponent({
  name: 'ComposeBoard',
  props: {
    composition: { type: Object as PropType<CompositionOwner>, required: true },
    drag: { type: Object as PropType<ConditionDrag>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    /** AI 按指令编排的进度；没在编排时为 null */
    building: { type: Object as PropType<BuildState | null>, default: null }
  },
  emits: {
    start: () => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const canvas = ref<HTMLElement>();
    const lanes = ref<HTMLElement>();
    const indicatorLane = ref<HTMLElement>();
    const boxes = shallowRef<ReadonlyMap<string, Box>>(new Map());
    const hovered = ref<string | null>(null);
    const editing = ref<ParamKey | null>(null);
    // 参数浮层里的草稿：节点、情景标记和下方的预估按它预览；浮层关闭时为 null
    const preview = shallowRef<SimulationParams | null>(null);
    const over = ref(false);
    // 拖入已有的条件时闪一下；次数的奇偶换动画名，同一个节点连续闪也会重新播放
    const flash = ref({ key: '', count: 0 });
    const pageActive = usePageActive();

    const conditions = computed(() => props.composition.state.value.conditions);
    const params = computed(() => props.composition.state.value.params);
    const shown = computed(() => preview.value ?? params.value);
    const links = computed(() => boardLinks(boxes.value, conditions.value, shown.value));
    const related = computed(() => relatedNodes(hovered.value, conditions.value));
    const missing = computed(() => missingConditions(conditions.value));
    // 节点是否显示：AI 编排时只显示已经出现的
    const visible = (key: string) => props.building === null || props.building.revealed.has(key);

    // 新出现的连线：画的期间按 pathLength = 1 从 0 画到 1，画完换回普通的线
    const drawing = shallowRef<ReadonlySet<string>>(new Set());
    let known = new Set<string>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    watch(links, current => {
      const ids = current.map(link => link.id);
      const added = ids.filter(id => !known.has(id));
      known = new Set(ids);
      if (added.length === 0 || reducedMotion()) {
        return;
      }
      drawing.value = new Set([...drawing.value, ...added]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        drawing.value = new Set([...drawing.value].filter(id => !added.includes(id)));
      }, DRAW_MS);
      timers.add(timer);
    });

    // 量出节点相对连线层的位置；包含动画中的变换，连线跟着动画走。页面被缓存期间量到的都是 0，保留原来的位置
    const measure = () => {
      const container = lanes.value;
      if (!container || !pageActive.value) {
        return;
      }
      const origin = container.getBoundingClientRect();
      const next = new Map<string, Box>();
      for (const element of container.querySelectorAll<HTMLElement>('[data-node]')) {
        const key = element.dataset.node;
        if (key !== undefined) {
          const rect = element.getBoundingClientRect();
          next.set(key, { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height });
        }
      }
      if (!sameBoxes(boxes.value, next)) {
        boxes.value = next;
      }
    };

    let frame = 0;
    let followUntil = 0;
    const follow = () => {
      measure();
      frame = performance.now() < followUntil ? requestAnimationFrame(follow) : 0;
    };
    const relayout = () => {
      measure();
      if (reducedMotion()) {
        return;
      }
      followUntil = performance.now() + FOLLOW_MS;
      if (frame === 0) {
        frame = requestAnimationFrame(follow);
      }
    };
    watch(() => props.composition.state.value, relayout, { flush: 'post' });
    watch(() => props.building, relayout, { flush: 'post' });
    // 条件变了，浮层里的参数可能已经不对，关掉
    watch(conditions, () => {
      editing.value = null;
    });
    watch(editing, key => {
      if (key === null) {
        preview.value = null;
      }
    });

    // 画布和每个节点的尺寸变化（字体加载、换行、窗口缩放）都重新量
    const observed = shallowRef<HTMLElement[]>([]);
    const syncObserved = () => {
      const container = lanes.value;
      const next = container ? [container, ...container.querySelectorAll<HTMLElement>('[data-node]')] : [];
      const current = observed.value;
      const same = next.length === current.length && next.every((element, index) => current[index] === element);
      if (!same) {
        observed.value = next;
      }
    };
    useResizeObserver(observed, measure);
    onMounted(() => {
      syncObserved();
      measure();
    });
    onUpdated(syncObserved);
    onBeforeUnmount(() => {
      cancelAnimationFrame(frame);
      timers.forEach(timer => clearTimeout(timer));
    });

    useSortableList(indicatorLane, {
      handle: '[data-indicator-handle]',
      draggable: '>[data-sortable-item]',
      onMove: (from, to) => props.composition.moveIndicator(from, to)
    });

    // 手柄上按上下方向键移动一位，移动后焦点回到这个手柄
    const onHandleKeydown = async (event: KeyboardEvent, id: string) => {
      const step = ARROW_STEPS[event.key] ?? 0;
      const ids = conditions.value.indicatorIds;
      const from = ids.indexOf(id);
      const to = from + step;
      if (step === 0 || from < 0 || to < 0 || to >= ids.length) {
        return;
      }
      event.preventDefault();
      props.composition.moveIndicator(from, to);
      await nextTick();
      indicatorLane.value?.querySelector<HTMLElement>(`[data-indicator-handle="${id}"]`)?.focus();
    };

    const flashNode = (key: string) => {
      flash.value = { key, count: flash.value.count + 1 };
    };

    // 画布里放不下时，把节点滚到看得见（只滚画布，不用 scrollIntoView：它会连带滚动外层的容器）
    const reveal = (key: string) => {
      const box = canvas.value;
      const element = box?.querySelector<HTMLElement>(`[data-node="${key}"]`);
      if (!box || !element) {
        return;
      }
      const view = box.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const margin = 16;
      const dy =
        rect.bottom + margin > view.bottom
          ? rect.bottom + margin - view.bottom
          : Math.min(0, rect.top - margin - view.top);
      const dx =
        rect.right + margin > view.right
          ? rect.right + margin - view.right
          : Math.min(0, rect.left - margin - view.left);
      if (dx !== 0 || dy !== 0) {
        box.scrollBy({ left: dx, top: dy, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    };

    // AI 编排出一个新节点：闪一下，滚到看得见
    watch(
      () => props.building?.latest ?? null,
      async key => {
        if (key === null) {
          return;
        }
        // AI 推演节点有自己的启动效果，不闪
        if (key !== OUTPUT_NODE) {
          flashNode(key);
        }
        await nextTick();
        reveal(key);
      }
    );

    // 放下：加上这一项；已经有了就闪一下对应的节点
    const addItem = (item: DragItem) => {
      const { composition } = props;
      switch (item.kind) {
        case 'years':
          return { added: composition.addYear(item.year), key: yearNode(item.year) };
        case 'region':
          return { added: composition.addCity(item.code), key: REGION_NODE };
        case 'indicators':
          break;
      }
      return { added: composition.addIndicator(item.id), key: indicatorNode(item.id) };
    };

    const onDragover = (event: DragEvent) => {
      if (!props.drag.item.value) {
        return;
      }
      event.preventDefault();
      over.value = true;
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDragleave = (event: DragEvent) => {
      const target = event.relatedTarget;
      if (!(target instanceof Node && canvas.value?.contains(target))) {
        over.value = false;
      }
    };
    const onDrop = (event: DragEvent) => {
      over.value = false;
      const item = props.drag.item.value;
      if (!item) {
        return;
      }
      event.preventDefault();
      props.drag.end();
      const { added, key } = addItem(item);
      if (!added) {
        flashNode(key);
      }
    };

    const applyParams = (key: ParamKey, next: SimulationParams) => {
      props.composition.setParams(next);
      editing.value = null;
      flashNode(paramNode(key));
    };

    // 悬停的节点：只认指标和参数
    const hoverProps = (key: string) => ({
      onPointerenter: () => (hovered.value = key),
      onPointerleave: () => (hovered.value = null)
    });

    const nodeClass = (key: string, kind: string) => [
      styles.node,
      styles[kind],
      hovered.value !== null && (related.value.has(key) ? styles.related : styles.dimmed),
      flash.value.key === key && (flash.value.count % 2 === 0 ? styles.flashEven : styles.flashOdd)
    ];

    // 节点出现时弹出、换位置时平移；移除的立刻消失，其余的随即平移补位（等节点自己的过渡会留下半透明的残影）
    const transition = {
      enterFromClass: styles.enterFrom,
      enterActiveClass: styles.enterActive,
      moveClass: styles.move,
      onLeave: (_element: Element, done: () => void) => done()
    };

    const renderYears = () => {
      const { years } = conditions.value;
      return [
        <TransitionGroup key="nodes" {...transition}>
          {years.filter(year => visible(yearNode(year))).map(year => {
            const key = yearNode(year);
            return (
              <div key={key} class={nodeClass(key, 'year')} data-node={key}>
                <SvgIcon class={styles.icon} name="simulation-calendar" />
                <b>{year}</b>
                {removeButton(`${year} 年`, () => props.composition.removeYear(year))}
              </div>
            );
          })}
        </TransitionGroup>,
        empty('years', years.length === 0 && props.building === null)
      ];
    };

    const renderRegion = () => {
      const { cityCodes } = conditions.value;
      const all = cityCodes.length === JIANGSU_CITIES.length;
      const districts = cityCodes.reduce((sum, code) => sum + districtsOf(code).length, 0);
      return [
        <TransitionGroup key="nodes" {...transition}>
          {cityCodes.length > 0 && visible(REGION_NODE) && (
            <div key={REGION_NODE} class={nodeClass(REGION_NODE, 'region')} data-node={REGION_NODE}>
              <div class={styles.regionHead}>
                <SvgIcon class={styles.icon} name="simulation-region" />
                <b>{all ? '全省' : `${cityCodes.length} 个市`}</b>
                <span class={styles.meta}>{districts} 个区县</span>
                {removeButton('监测范围', () => props.composition.setAllCities(false))}
              </div>
              <div class={[styles.cityTags, props.building !== null && styles.tagsIn]}>
                {cityCodes.map((code, index) => {
                  const name = shortRegionName(JIANGSU_CITIES.find(city => city.code === code)?.name ?? code);
                  return (
                    <span key={code} class={styles.cityTag} style={{ '--tag-index': index }}>
                      {name}
                      <button type="button" aria-label={`移除${name}`} onClick={() => props.composition.removeCity(code)}>
                        <SvgIcon name="close" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </TransitionGroup>,
        empty('region', cityCodes.length === 0 && props.building === null)
      ];
    };

    const renderIndicators = () => {
      const { indicatorIds } = conditions.value;
      return [
        <TransitionGroup key="nodes" {...transition}>
          {indicatorIds.filter(id => visible(indicatorNode(id))).map(id => {
            const key = indicatorNode(id);
            const indicator = simulationIndicator(id);
            return (
              <div
                key={key}
                class={nodeClass(key, 'indicator')}
                data-node={key}
                data-sortable-item
                {...hoverProps(key)}
              >
                <button
                  type="button"
                  class={styles.handle}
                  data-indicator-handle={id}
                  aria-label={`调整顺序：${indicator.name}`}
                  title="拖动或按上下方向键调整顺序"
                  onKeydown={event => void onHandleKeydown(event, id)}
                >
                  <SvgIcon name="drag-handle" />
                </button>
                <div class={styles.text}>
                  <b class={styles.indicatorName} title={`${indicator.name}（${reachText(indicator)}）`}>
                    <span>{indicator.name}</span>（{indicator.unit}）
                  </b>
                  <span class={styles.indicatorMeta}>
                    <span class={styles.meta}>{indicator.id}</span>
                    {isScenario(shown.value, id) && <span class={styles.scenarioTag}>自定义口径</span>}
                  </span>
                </div>
                {removeButton(indicator.name, () => props.composition.removeIndicator(id))}
              </div>
            );
          })}
        </TransitionGroup>,
        empty('indicators', indicatorIds.length === 0 && props.building === null)
      ];
    };

    const renderParams = () => {
      if (conditions.value.indicatorIds.length === 0) {
        return null;
      }
      const keys = paramsOf(conditions.value.indicatorIds).filter(key => visible(paramNode(key)));
      return keys.map(key => {
        const node = paramNode(key);
        const scenario = !isStandard(key, shown.value);
        return (
          <ElPopover
            key={node}
            trigger="click"
            placement="left"
            width={340}
            persistent={false}
            popperStyle={{ padding: 0 }}
            visible={editing.value === key}
            onUpdate:visible={open => {
              if (open) {
                editing.value = key;
              } else if (editing.value === key) {
                editing.value = null;
              }
            }}
          >
            {{
              // 触发元素是外层的 span：Element 在触发元素重新渲染时会去掉它上面的 aria 属性，按钮自己的属性放在里层
              reference: () => (
                <span class={styles.paramSlot}>
                  <button
                    type="button"
                    class={[nodeClass(node, 'param'), scenario && styles.scenarioParam]}
                    data-node={node}
                    aria-haspopup="dialog"
                    aria-expanded={editing.value === key}
                    onFocus={event => {
                      // 只在键盘移入时高亮，点击后焦点留在节点上不算
                      if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) {
                        hovered.value = node;
                      }
                    }}
                    onBlur={() => (hovered.value = null)}
                    {...hoverProps(node)}
                  >
                    <span class={styles.text}>
                      <span class={styles.meta}>{PARAM_LABELS[key]}</span>
                      <b>{describeParam(key, shown.value, conditions.value)}</b>
                    </span>
                  <SvgIcon class={styles.edit} name="simulation-tune" />
                </button>
                </span>
              ),
              default: () => (
                <ParamPopover
                  paramKey={key}
                  conditions={conditions.value}
                  params={params.value}
                  onPreview={next => (preview.value = next)}
                  onApply={next => applyParams(key, next)}
                  onCancel={() => (editing.value = null)}
                />
              )
            }}
          </ElPopover>
        );
      });
    };

    const renderOutput = () => {
      if (!visible(OUTPUT_NODE)) {
        return null;
      }
      const { years, cityCodes, indicatorIds } = conditions.value;
      const { model } = props;
      const ready = missing.value.length === 0;
      const launching = props.building?.launching ?? false;
      let status: VNodeChild = null;
      if (model.status === 'loading') {
        status = <span class={styles.meta}>区县数据加载中…</span>;
      } else if (model.status === 'failed') {
        status = (
          <span class={styles.meta}>
            区县数据加载失败
            <ElButton link type="primary" onClick={() => emit('retry')}>
              重试
            </ElButton>
          </span>
        );
      }
      return (
        <div
          class={[nodeClass(OUTPUT_NODE, 'output'), ready && styles.armed, launching && styles.launching]}
          data-node={OUTPUT_NODE}
        >
          <ChatAvatar class={styles.robot} speaker="assistant" size={44} />
          <b>AI计算</b>
          <span class={styles.meta}>
            {ready
              ? `${years.length} 个年度 × ${cityCodes.length} 市 × ${indicatorIds.length} 项指标`
              : `还缺：${missing.value.map(kind => CONDITION_LABELS[kind]).join('、')}`}
          </span>
          <span class={styles.meta}>
            {ready
              ? `共 ${years.length * cityCodes.length * indicatorIds.length} 个市级结果 · ${STEP_GROUPS.length} 个步骤`
              : '从左侧点选或拖入'}
          </span>
          {status}
          <ElButton
            class={styles.start}
            type="primary"
            icon={VideoPlay}
            loading={launching}
            disabled={!ready || model.status !== 'ready' || (props.building !== null && !launching)}
            onClick={() => emit('start')}
          >
            {launching ? '计算启动中' : '开始计算'}
          </ElButton>
        </div>
      );
    };

    const LANE_CONTENT: Readonly<Record<BoardLane, () => VNodeChild>> = {
      years: renderYears,
      region: renderRegion,
      indicators: renderIndicators,
      params: renderParams,
      output: renderOutput
    };

    return () => {
      const ready = missing.value.length === 0;
      return (
        <MxPanel class={styles.panel} headerTone="muted" flush>
          {{
            header: () => [
              <StageStepper key="stepper" phase="compose" />,
              props.building && (
                <div key="status" class={styles.aiStatus} role="status">
                  <ChatAvatar class={styles.statusRobot} speaker="assistant" size={20} />
                  {props.building.message}
                </div>
              )
            ],
            default: () => [
              <div
                key="canvas"
                ref={canvas}
                class={[styles.canvas, ready && styles.ready, over.value && styles.over]}
                data-drop={props.drag.item.value?.kind}
                onDragover={onDragover}
                onDragleave={onDragleave}
                onDrop={onDrop}
              >
                <div ref={lanes} class={[styles.lanes, hovered.value !== null && styles.hovering]}>
                  <svg class={styles.links} aria-hidden="true">
                    {links.value.map(link => (
                      <path
                        key={link.id}
                        class={[
                          styles.link,
                          styles[link.kind],
                          isLit(link, hovered.value, related.value) && styles.lit,
                          drawing.value.has(link.id) && styles.drawing
                        ]}
                        d={link.d}
                        pathLength={drawing.value.has(link.id) ? 1 : undefined}
                      />
                    ))}
                  </svg>
                  {LANES.map(lane => (
                    <div key={`head-${lane.id}`} class={styles.laneHead}>
                      {lane.icon === null ? <ChatAvatar speaker="assistant" size={20} /> : <SvgIcon name={lane.icon} />}
                      {lane.label}
                    </div>
                  ))}
                  {LANES.map(lane => (
                    <div
                      key={lane.id}
                      ref={lane.id === 'indicators' ? indicatorLane : undefined}
                      class={styles.lane}
                      data-lane={lane.id}
                    >
                      {LANE_CONTENT[lane.id]()}
                    </div>
                  ))}
                </div>
              </div>,
              <EstimateBar
                key="estimate"
                model={props.model}
                conditions={conditions.value}
                params={shown.value}
                previewing={preview.value !== null}
              />
            ]
          }}
        </MxPanel>
      );
    };
  }
});
