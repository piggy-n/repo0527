import { useResizeObserver } from '@vueuse/core';
import { useMapOverlay, usePageActive, useShownElementSize } from '@mx/map-vue';
import { MxPanel, MxTitle } from '@mx/ui';
import { ElButton } from 'element-plus';
import { computed, defineComponent, onScopeDispose, type PropType, ref, type SlotsType, type VNode, watch } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { ratioForCheckedHeight, splitLists } from './panel-split';
import styles from './LayerPanelShell.module.scss';

/** 标题后面的一个页签 */
export interface PanelTab {
  readonly id: string;
  readonly label: string;
}

/** 交给浮层插槽的元素：浮层贴着面板、箭头对着当前图层里的行 */
export interface PanelFloatingContext {
  readonly panel: () => HTMLElement | null;
  readonly list: () => HTMLElement | null;
}

// 分割线的高度：线在中间，上下留出一样的间距
const SPLITTER_HEIGHT = 24;
// 键盘调整分割线的一步
const RATIO_STEP = 0.05;
const renderSectionTitle = (title: string) => <span class={styles.sectionTitle}>{title}</span>;

// 上下方向键：上 -1、下 1，其他 0
const arrowStep = (event: KeyboardEvent) => ({ ArrowUp: -1, ArrowDown: 1 })[event.key] ?? 0;

/**
 * 资源图层面板的外壳（ADR 0157，取代 0053 第 6 节的两区）：标题、页签、收起竖条，下面是"资源目录"和"当前图层"两段，
 * 中间的分割线可以拖动（高度的分法同 ADR 0060，panel-split.ts）。两段的内容、工具栏和浮层都由页面经插槽给出；
 * 分割线的位置由页面持有（记在偏好里），收起与否由页面给出。会挡住定位，登记为贴左边的悬浮元素
 */
export const LayerPanelShell = defineComponent({
  name: 'LayerPanelShell',
  props: {
    title: { type: String, required: true },
    /** 第一个是主页签，显示两段；其余显示"暂无数据" */
    tabs: { type: Array as PropType<readonly PanelTab[]>, required: true },
    /**
     * 资源目录这一段的状态：不是 ready 时目录换成加载中或失败和重试；搜索行、浮层照常（页面按目录当前显示的内容给，
     * 只看三维模型时资源目录没到也是 ready，ADR 0157）
     */
    status: { type: String as PropType<'ready' | 'loading' | 'failed'>, default: 'ready' },
    collapsed: { type: Boolean, default: false },
    /** 分割线的位置：当前图层占可用高度的比例 */
    ratio: { type: Number, required: true },
    /** 资源目录标题后面的文字页签（目录显示什么，ADR 0157）；空的时候没有 */
    views: { type: Array as PropType<readonly PanelTab[]>, default: () => [] },
    /** 选中的那个页签的 id */
    view: { type: String, default: '' }
  },
  emits: {
    retry: () => true,
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean',
    'update:ratio': (ratio: number) => ratio >= 0 && ratio <= 1,
    'update:view': (view: string) => typeof view === 'string'
  },
  slots: Object as SlotsType<{
    catalogTools: () => VNode[];
    catalogFilter: () => VNode[];
    catalog: () => VNode[];
    currentTools: () => VNode[];
    current: () => VNode[];
    floating: (context: PanelFloatingContext) => VNode[];
  }>,
  setup(props, { emit, slots }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'left');
    const panel = ref<HTMLElement>();
    const list = ref<HTMLElement>();
    const tab = ref(props.tabs[0]?.id ?? '');
    const core = computed(() => tab.value === props.tabs[0]?.id);

    // 两段最多能用的高度：面板所在的列的高度，减去面板的标题和分割线。不用两段量到的高度：它又由分法决定，会来回重算
    const column = computed(() => element.value?.parentElement ?? null);
    const { height: columnHeight } = useShownElementSize(column);
    // 面板标题的高度：面板和两段的高度差，和内容无关，在两段出现或尺寸变化时量。
    // 不监听面板和两段的内容：它们跟着内容变，又比内容那一层浅，浏览器同一帧里不再通知，报 ResizeObserver loop 的错误
    const sections = ref<HTMLElement>();
    const catalogHead = ref<HTMLElement>();
    const chrome = ref(0);
    // 所在页面停用（被缓存）期间量到的 0 不采用（ADR 0063）
    const pageActive = usePageActive();
    useResizeObserver(catalogHead, () => {
      if (pageActive.value && panel.value && sections.value) {
        chrome.value = panel.value.getBoundingClientRect().height - sections.value.getBoundingClientRect().height;
      }
    });
    const available = computed(() => Math.max(0, Math.floor(columnHeight.value - chrome.value - SPLITTER_HEIGHT)));
    // 两段本来的高度：标题、搜索行和滚动区里包的一层分别量，不受分到的高度影响
    const box = { box: 'border-box' } as const;
    const filter = ref<HTMLElement>();
    const catalogInner = ref<HTMLElement>();
    const currentHead = ref<HTMLElement>();
    const currentInner = ref<HTMLElement>();
    const { height: catalogHeadHeight } = useShownElementSize(catalogHead, undefined, box);
    const { height: filterHeight } = useShownElementSize(filter, undefined, box);
    const { height: catalogInnerHeight } = useShownElementSize(catalogInner, undefined, box);
    const { height: currentHeadHeight } = useShownElementSize(currentHead, undefined, box);
    const { height: currentInnerHeight } = useShownElementSize(currentInner, undefined, box);
    const catalogHeight = computed(() => catalogHeadHeight.value + filterHeight.value + catalogInnerHeight.value);
    const currentHeight = computed(() => currentHeadHeight.value + currentInnerHeight.value);
    // 都量到之前不设高度，按内容排
    const split = computed(() =>
      columnHeight.value > 0 && chrome.value > 0
        ? splitLists({
            available: available.value,
            tree: catalogHeight.value,
            checked: currentHeight.value,
            ratio: props.ratio
          })
        : null
    );
    const currentSectionHeight = computed(() => split.value?.checked ?? 0);
    // 拖动改变不了两段时分割线不响应，也不显示成能拖的样子
    const adjustable = computed(() => split.value?.adjustable ?? false);
    const setCurrentHeight = (height: number) => {
      const ratio = ratioForCheckedHeight(available.value, height);
      if (ratio !== null) {
        emit('update:ratio', ratio);
      }
    };

    // 拖动归面板所有：失去捕获、页面停用、面板隐藏或卸载时结束
    let stopSplitterDrag: (() => void) | undefined;
    watch(
      () => pageActive.value && !props.collapsed && core.value && adjustable.value,
      active => {
        if (!active) {
          stopSplitterDrag?.();
        }
      },
      { flush: 'sync' }
    );
    onScopeDispose(() => stopSplitterDrag?.());

    // 拖动分割线：按住后跟着指针改当前图层的高度，松开时结束
    const onSplitterPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !adjustable.value || !(event.currentTarget instanceof HTMLElement)) {
        return;
      }
      const splitter = event.currentTarget;
      stopSplitterDrag?.();
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = currentSectionHeight.value;
      splitter.setPointerCapture(pointerId);
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) {
          return;
        }
        if ((move.buttons & 1) === 0) {
          onEnd();
          return;
        }
        setCurrentHeight(startHeight - (move.clientY - startY));
      };
      const onEnd = (end?: PointerEvent) => {
        if (end && end.pointerId !== pointerId) {
          return;
        }
        splitter.removeEventListener('pointermove', onMove);
        splitter.removeEventListener('pointerup', onEnd);
        splitter.removeEventListener('pointercancel', onEnd);
        splitter.removeEventListener('lostpointercapture', onEnd);
        if (splitter.hasPointerCapture(pointerId)) {
          splitter.releasePointerCapture(pointerId);
        }
        stopSplitterDrag = undefined;
      };
      stopSplitterDrag = onEnd;
      splitter.addEventListener('pointermove', onMove);
      splitter.addEventListener('pointerup', onEnd);
      splitter.addEventListener('pointercancel', onEnd);
      splitter.addEventListener('lostpointercapture', onEnd);
    };

    // 分割线上按上下方向键：往上是当前图层变高
    const onSplitterKeydown = (event: KeyboardEvent) => {
      const step = arrowStep(event);
      if (step === 0 || !adjustable.value) {
        return;
      }
      event.preventDefault();
      setCurrentHeight(currentSectionHeight.value - step * RATIO_STEP * available.value);
    };

    const renderStatus = () =>
      props.status === 'failed' ? (
        <div class={styles.status}>
          <span>资源目录加载失败</span>
          <ElButton size="small" onClick={() => emit('retry')}>
            重试
          </ElButton>
        </div>
      ) : (
        <div class={styles.status}>正在加载资源目录…</div>
      );

    const renderCore = () => (
      <div ref={sections} class={styles.sections}>
        <section
          class={styles.section}
          aria-label="资源目录"
          style={split.value ? { height: `${split.value.tree}px` } : undefined}
          data-panel-section="catalog"
        >
          <div ref={catalogHead} class={styles.sectionHead}>
            {renderSectionTitle('资源目录')}
            {props.views.length > 0 && (
              <nav class={[styles.tabs, styles.views]} role="tablist" aria-label="资源目录显示的内容">
                {props.views.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    class={[styles.tab, props.view === item.id && styles.currentTab]}
                    aria-selected={props.view === item.id}
                    data-catalog-view={item.id}
                    onClick={() => emit('update:view', item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            )}
            {slots.catalogTools()}
          </div>
          <div ref={filter} class={styles.filter}>
            {slots.catalogFilter()}
          </div>
          <div class={styles.scroll}>
            <div ref={catalogInner} class={styles.catalog}>
              {props.status === 'ready' ? slots.catalog() : renderStatus()}
            </div>
          </div>
        </section>
        <div
          class={[styles.splitter, !adjustable.value && styles.fixed]}
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整资源目录和当前图层的高度"
          aria-disabled={!adjustable.value}
          aria-valuenow={Math.round(props.ratio * 100)}
          tabindex={0}
          onPointerdown={onSplitterPointerDown}
          onKeydown={onSplitterKeydown}
        >
          <span class={styles.splitterHandle}>
            <SvgIcon name="splitter-handle" size={14} />
          </span>
        </div>
        <section
          class={styles.section}
          aria-label="当前图层"
          style={split.value ? { height: `${split.value.checked}px` } : undefined}
          data-panel-section="current"
        >
          <div ref={currentHead} class={styles.sectionHead}>
            {renderSectionTitle('当前图层')}
            {slots.currentTools()}
          </div>
          <div ref={list} class={styles.scroll} data-current-list>
            <div ref={currentInner} class={styles.current}>
              {slots.current()}
            </div>
          </div>
        </section>
      </div>
    );

    const floating: PanelFloatingContext = { panel: () => panel.value ?? null, list: () => list.value ?? null };

    return () => (
      <div ref={element} class={styles.root} data-layer-panel>
        {props.collapsed ? (
          <button
            type="button"
            class={styles.strip}
            aria-label={`展开${props.title}`}
            onClick={() => emit('update:collapsed', false)}
          >
            <SvgIcon class={styles.stripIcon} name="panel-expand" size={16} />
            <span class={styles.stripLabel}>{props.title}</span>
          </button>
        ) : (
          <div ref={panel} class={styles.panelBox}>
            <MxPanel floating flush headerTone="muted" class={styles.panel}>
              {{
                header: () => (
                  <div class={styles.header}>
                    <MxTitle level="panel">{props.title}</MxTitle>
                    <nav class={styles.tabs} role="tablist">
                      {props.tabs.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          role="tab"
                          class={[styles.tab, tab.value === item.id && styles.currentTab]}
                          aria-selected={tab.value === item.id}
                          onClick={() => (tab.value = item.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </nav>
                  </div>
                ),
                actions: () => (
                  <button
                    type="button"
                    class={styles.collapse}
                    aria-label={`收起${props.title}`}
                    onClick={() => emit('update:collapsed', true)}
                  >
                    <SvgIcon name="panel-collapse" size={16} />
                  </button>
                ),
                default: () =>
                  core.value ? renderCore() : <div class={[styles.status, styles.placeholder]}>暂无数据</div>
              }}
            </MxPanel>
          </div>
        )}
        {!props.collapsed && core.value && slots.floating(floating)}
      </div>
    );
  }
});
