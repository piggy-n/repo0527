import { Search } from '@element-plus/icons-vue';
import { useElementSize } from '@vueuse/core';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElInput, ElOption, ElSelect } from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { CATALOG_ROOT } from '../catalog-order';
import type { CatalogOrderOwner } from '../composables/useCatalogOrder';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourcePanelLayout } from '../composables/useResourcePanelLayout';
import { checkedLayers, expandedByDefault, panelTree } from '../layer-panel';
import { batchYearOptions } from '../resource-layers';
import { CheckedLayerList } from './CheckedLayerList';
import { arrowStep, ResourceTreeList } from './ResourceTreeList';
import styles from './ResourceLayerPanel.module.scss';

// 头部的页签：统计报表、分节点资源先显示"暂无数据"（ADR 0053 第 6 节）
const TABS = [
  { id: 'core', label: '主节点' },
  { id: 'report', label: '统计报表' },
  { id: 'nodes', label: '分节点资源' }
] as const;
type TabId = (typeof TABS)[number]['id'];

// 分割线两边的最小高度：目录至少 3 行，"已勾选"至少放得下标题和 2 行
const MIN_TREE_HEIGHT = 3 * 32;
const MIN_CHECKED_HEIGHT = 30 + 2 * 36;
const SPLITTER_HEIGHT = 16;
// 键盘调整分割线的一步
const RATIO_STEP = 0.05;

/** "已勾选"区的高度：按比例，限制在两边的最小高度以内；放不下两边的最小高度时只按比例 */
export function checkedAreaHeight(available: number, ratio: number): number {
  const wanted = available * ratio;
  if (available < MIN_TREE_HEIGHT + MIN_CHECKED_HEIGHT) {
    return Math.max(0, wanted);
  }
  return Math.min(available - MIN_TREE_HEIGHT, Math.max(MIN_CHECKED_HEIGHT, wanted));
}

/**
 * 资源图层面板（ADR 0053 第 6 节，设计稿 5D.2）：目录树负责浏览、勾选和目录顺序，"已勾选"按叠放顺序调整顺序、年份和透明度，
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

    const searching = computed(() => keyword.value.trim() !== '');
    const tree = computed(() => panelTree(props.layers.state.value, keyword.value, props.catalogOrder.order.value));
    const checkedCount = computed(() => checkedLayers(props.layers.state.value).length);
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

    // 目录和"已勾选"两区的可用高度：量列表区域，减去分割线
    const lists = ref<HTMLElement>();
    const { height: listsHeight } = useElementSize(lists);
    const available = computed(() => Math.max(0, listsHeight.value - SPLITTER_HEIGHT));
    const checkedHeight = computed(() => checkedAreaHeight(available.value, props.layout.checkedRatio.value));

    const setCheckedHeight = (height: number) => {
      if (available.value > 0) {
        props.layout.setCheckedRatio(checkedAreaHeight(available.value, height / available.value) / available.value);
      }
    };

    // 拖动分割线：按住后跟着指针改"已勾选"区的高度，松开时结束
    const onSplitterPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) {
        return;
      }
      const splitter = event.currentTarget;
      const startY = event.clientY;
      const startHeight = checkedHeight.value;
      splitter.setPointerCapture(event.pointerId);
      const onMove = (move: PointerEvent) => setCheckedHeight(startHeight - (move.clientY - startY));
      const onEnd = () => {
        splitter.removeEventListener('pointermove', onMove);
        splitter.removeEventListener('pointerup', onEnd);
        splitter.removeEventListener('pointercancel', onEnd);
      };
      splitter.addEventListener('pointermove', onMove);
      splitter.addEventListener('pointerup', onEnd);
      splitter.addEventListener('pointercancel', onEnd);
    };

    // 分割线上按上下方向键：往上是"已勾选"区变高
    const onSplitterKeydown = (event: KeyboardEvent) => {
      const step = arrowStep(event);
      if (step === 0 || available.value <= 0) {
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
          <div class={styles.filter}>
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
            <div class={styles.tree}>
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
            <div
              class={styles.splitter}
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整目录和已勾选的高度"
              aria-valuenow={Math.round(props.layout.checkedRatio.value * 100)}
              tabindex={0}
              onPointerdown={onSplitterPointerDown}
              onKeydown={onSplitterKeydown}>
              <span class={styles.splitterHandle}>
                <SvgIcon name="splitter-handle" size={14} />
              </span>
            </div>
            <div class={styles.checked} style={{ height: `${checkedHeight.value}px` }}>
              <div class={styles.checkedHead}>
                <MxTitle>已勾选</MxTitle>
                <span class={styles.badge}>{checkedCount.value}</span>
              </div>
              <div class={styles.checkedList}>
                <CheckedLayerList layers={props.layers} />
              </div>
            </div>
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
