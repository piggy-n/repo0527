import { ArrowDown, ArrowUp, Search } from '@element-plus/icons-vue';
import { useResizeObserver } from '@vueuse/core';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElIcon, ElInput, ElOption, ElSelect } from 'element-plus';
import { computed, defineComponent, onScopeDispose, type PropType, ref, watch } from 'vue';
import { usePageActive } from '@/shared/composables/usePageActive';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { CATALOG_ROOT } from '../catalog-order';
import type { CatalogOrderOwner } from '../composables/useCatalogOrder';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourcePanelLayout } from '../composables/useResourcePanelLayout';
import { arrowStep } from '../keyboard';
import { checkedLayers, expandedByDefault, panelTree } from '../layer-panel';
import { ratioForCheckedHeight, splitLists } from '../panel-split';
import { batchYearOptions } from '../resource-layers';
import { CheckedLayerList } from './CheckedLayerList';
import { ResourceTreeList } from './ResourceTreeList';
import styles from './ResourceLayerPanel.module.scss';

// 头部的页签：统计报表、分节点资源先显示"暂无数据"（ADR 0053 第 6 节）
const TABS = [
  { id: 'core', label: '主节点' },
  { id: 'report', label: '统计报表' },
  { id: 'nodes', label: '分节点资源' }
] as const;
type TabId = (typeof TABS)[number]['id'];

// 分割线的高度：线在中间，上下留出一样的间距
const SPLITTER_HEIGHT = 24;
// 键盘调整分割线的一步
const RATIO_STEP = 0.05;

/**
 * 资源图层面板（ADR 0053 第 6 节、ADR 0060，设计稿 5D.2）：目录树负责浏览、勾选和目录顺序，"已勾选"按叠放顺序调整顺序、年份和透明度，
 * 两区之间的分割线可以拖动。只显示拥有者的状态并调用它们的操作；收起和分割线的位置由面板布局的拥有者记住，
 * 窄屏时让给右边由页面决定，所以收起与否由页面通过 collapsed 给出。会挡住定位，登记为贴左边的悬浮元素
 */
export const ResourceLayerPanel = defineComponent({
  name: 'ResourceLayerPanel',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    catalogOrder: { type: Object as PropType<CatalogOrderOwner>, required: true },
    layout: { type: Object as PropType<ResourcePanelLayout>, required: true },
    /** 目录加载失败；已经有目录时照常显示它 */
    failed: { type: Boolean, default: false },
    /** 显示为收起：用户收起了，或窄屏时让给右边 */
    collapsed: { type: Boolean, default: false }
  },
  emits: {
    retry: () => true,
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'left');

    // 以下都是面板自己的界面状态
    const tab = ref<TabId>('core');
    const keyword = ref('');
    const expanded = ref<ReadonlySet<string>>(new Set());
    // 首次进入默认收起，不写入偏好；页面缓存期间保留用户的展开
    const checkedCollapsed = ref(true);

    const searching = computed(() => keyword.value.trim() !== '');
    const tree = computed(() => panelTree(props.layers.state.value, keyword.value, props.catalogOrder.order.value));
    const checkedCount = computed(() => checkedLayers(props.layers.state.value).length);
    // 没有勾选资源时隐藏整个区域，不占用目录高度；保留用户的展开状态
    const hasChecked = computed(() => checkedCount.value > 0);
    const checkedExpanded = computed(() => hasChecked.value && !checkedCollapsed.value);
    const batchYears = computed(() => batchYearOptions(props.layers.state.value.catalog));

    // 目录第一次到达时展开含有勾选资源的分类；之后目录刷新不改用户的展开
    watch(
      () => props.layers.state.value.catalog,
      (catalog, previous) => {
        if (catalog && !previous) {
          expanded.value = expandedByDefault(panelTree(props.layers.state.value));
        }
      },
      { immediate: true }
    );

    const toggleExpanded = (id: string) => {
      const next = new Set(expanded.value);
      if (!next.delete(id)) {
        next.add(id);
      }
      expanded.value = next;
    };

    // 两区最多能用的高度：面板所在的列（页面上纵向 flex 的一列）的高度就是面板最高能到的高度，减去头部、搜索行
    // 和分割线。不用两区量到的高度：它又由分法决定，会来回重算
    const column = computed(() => element.value?.parentElement ?? null);
    const { height: columnHeight } = useShownElementSize(column);
    // 头部、搜索行的高度：面板不被列压缩，它就是面板和两区的高度差，和内容无关，在搜索行出现或尺寸变化时量。
    // 不监听面板和两区：它们跟着内容变，又比内容那一层浅，浏览器同一帧里不再通知，报 ResizeObserver loop 的错误
    const filter = ref<HTMLElement>();
    const lists = ref<HTMLElement>();
    const chrome = ref(0);
    // 所在页面停用（被缓存）期间量到的 0 不采用（ADR 0063）
    const pageActive = usePageActive();
    useResizeObserver(filter, () => {
      if (pageActive.value && element.value && lists.value) {
        chrome.value = element.value.getBoundingClientRect().height - lists.value.getBoundingClientRect().height;
      }
    });
    const available = computed(() =>
      Math.max(0, Math.floor(columnHeight.value - chrome.value - (checkedExpanded.value ? SPLITTER_HEIGHT : 0)))
    );
    // 两区的内容本来的高度：各包一层量，不受两区的高度影响
    const treeContent = ref<HTMLElement>();
    const { height: treeHeight } = useShownElementSize(treeContent);
    const checkedHead = ref<HTMLElement>();
    const { height: checkedHeadHeight } = useShownElementSize(checkedHead, undefined, { box: 'border-box' });
    const checkedContent = ref<HTMLElement>();
    const { height: checkedContentHeight } = useShownElementSize(checkedContent, undefined, { box: 'border-box' });
    // 都量到之前不设高度，按内容排
    const split = computed(() =>
      columnHeight.value > 0 && chrome.value > 0
        ? splitLists({
            available: available.value,
            tree: treeHeight.value,
            checked: hasChecked.value
              ? checkedHeadHeight.value + (checkedExpanded.value ? checkedContentHeight.value : 0)
              : 0,
            ratio: props.layout.checkedRatio.value,
            collapsed: !checkedExpanded.value
          })
        : null
    );
    const checkedHeight = computed(() => split.value?.checked ?? 0);
    // 拖动改变不了两区时分割线不响应，也不显示成能拖的样子
    const adjustable = computed(() => split.value?.adjustable ?? false);
    const setCheckedHeight = (height: number) => {
      const ratio = ratioForCheckedHeight(available.value, height);
      if (ratio !== null) {
        props.layout.setCheckedRatio(ratio);
      }
    };

    // 拖动归面板所有：失去捕获、页面停用、面板隐藏或卸载时结束
    let stopSplitterDrag: (() => void) | undefined;
    watch(
      () => pageActive.value && !props.collapsed && tab.value === 'core' && adjustable.value,
      active => {
        if (!active) {
          stopSplitterDrag?.();
        }
      },
      { flush: 'sync' }
    );
    onScopeDispose(() => stopSplitterDrag?.());

    // 拖动分割线：按住后跟着指针改"已勾选"区的高度，松开时结束
    const onSplitterPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !adjustable.value || !(event.currentTarget instanceof HTMLElement)) {
        return;
      }
      const splitter = event.currentTarget;
      stopSplitterDrag?.();
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = checkedHeight.value;
      splitter.setPointerCapture(pointerId);
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) {
          return;
        }
        if ((move.buttons & 1) === 0) {
          onEnd();
          return;
        }
        setCheckedHeight(startHeight - (move.clientY - startY));
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

    // 分割线上按上下方向键：往上是"已勾选"区变高
    const onSplitterKeydown = (event: KeyboardEvent) => {
      const step = arrowStep(event);
      if (step === 0 || !adjustable.value) {
        return;
      }
      event.preventDefault();
      setCheckedHeight(checkedHeight.value - step * RATIO_STEP * available.value);
    };

    const renderStatus = () =>
      props.failed ? (
        <div class={styles.status}>
          <span>资源目录加载失败</span>
          <ElButton size="small" onClick={() => emit('retry')}>
            重试
          </ElButton>
        </div>
      ) : (
        <div class={styles.status}>正在加载资源目录…</div>
      );

    const renderCore = () => {
      if (!props.layers.state.value.catalog) {
        return renderStatus();
      }
      return (
        <>
          <div ref={filter} class={styles.filter}>
            <ElInput
              class={styles.search}
              modelValue={keyword.value}
              clearable
              prefixIcon={Search}
              placeholder="搜索资源"
              onUpdate:modelValue={(value: string) => (keyword.value = value)}
            />
            {batchYears.value.length > 0 && (
              // 批量设置是一次操作（ADR 0052 第 2 节）：选完就执行、不保留选中值，所以连续两次选同一年也会执行
              <ElSelect
                class={styles.batch}
                modelValue={undefined}
                placeholder="批量设置年份"
                aria-label="批量设置年份"
                onUpdate:modelValue={(year: number) => props.layers.setYearForAll(year)}>
                {batchYears.value.map(year => (
                  <ElOption key={year} label={`${year} 年`} value={year} />
                ))}
              </ElSelect>
            )}
          </div>
          <div ref={lists} class={styles.lists}>
            <div class={styles.tree} style={split.value ? { height: `${split.value.tree}px` } : undefined}>
              <div ref={treeContent}>
                {tree.value.length > 0 ? (
                  <ResourceTreeList
                    nodes={tree.value}
                    parentId={CATALOG_ROOT}
                    depth={0}
                    expanded={expanded.value}
                    searching={searching.value}
                    layers={props.layers}
                    catalogOrder={props.catalogOrder}
                    onToggle={toggleExpanded}
                  />
                ) : (
                  <div class={styles.status}>没有找到资源</div>
                )}
              </div>
            </div>
            {checkedExpanded.value && (
              <div
                class={[styles.splitter, !adjustable.value && styles.fixed]}
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整目录和已勾选的高度"
                aria-disabled={!adjustable.value}
                aria-valuenow={Math.round(props.layout.checkedRatio.value * 100)}
                tabindex={0}
                onPointerdown={onSplitterPointerDown}
                onKeydown={onSplitterKeydown}>
                <span class={styles.splitterHandle}>
                  <SvgIcon name="splitter-handle" size={14} />
                </span>
              </div>
            )}
            {hasChecked.value && (
              <div class={styles.checked} style={split.value ? { height: `${split.value.checked}px` } : undefined}>
                <button
                  ref={checkedHead}
                  type="button"
                  class={[styles.checkedHead, checkedCollapsed.value && styles.checkedCollapsed]}
                  aria-label={checkedCollapsed.value ? '展开已勾选图层' : '收起已勾选图层'}
                  aria-expanded={!checkedCollapsed.value}
                  onClick={() => (checkedCollapsed.value = !checkedCollapsed.value)}>
                  <span class={styles.checkedTitle}>已勾选</span>
                  <span class={styles.badge}>{checkedCount.value}</span>
                  <span class={styles.checkedToggle}>{checkedCollapsed.value ? '展开' : '收起图层'}</span>
                  <ElIcon>{checkedCollapsed.value ? <ArrowUp /> : <ArrowDown />}</ElIcon>
                </button>
                {checkedExpanded.value && (
                  <div class={styles.checkedList}>
                    <div ref={checkedContent} class={styles.checkedContent}>
                      <CheckedLayerList layers={props.layers} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      );
    };

    return () => (
      <div ref={element} class={styles.root} data-resource-layer-panel>
        {props.collapsed ? (
          <button
            type="button"
            class={styles.strip}
            aria-label="展开资源图层"
            onClick={() => emit('update:collapsed', false)}>
            <SvgIcon class={styles.stripIcon} name="panel-expand" size={16} />
            <span class={styles.stripLabel}>资源图层</span>
          </button>
        ) : (
          <MxPanel floating flush class={styles.panel}>
            {{
              header: () => (
                <div class={styles.header}>
                  <MxTitle level="panel">资源图层</MxTitle>
                  <nav class={styles.tabs} role="tablist">
                    {TABS.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        class={[styles.tab, tab.value === item.id && styles.currentTab]}
                        aria-selected={tab.value === item.id}
                        onClick={() => (tab.value = item.id)}>
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
                  aria-label="收起资源图层"
                  onClick={() => emit('update:collapsed', true)}>
                  <SvgIcon name="panel-collapse" size={16} />
                </button>
              ),
              default: () =>
                tab.value === 'core' ? renderCore() : <div class={[styles.status, styles.placeholder]}>暂无数据</div>
            }}
          </MxPanel>
        )}
      </div>
    );
  }
});
