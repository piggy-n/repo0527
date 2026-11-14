import { Search } from '@element-plus/icons-vue';
import { useMap } from '@mx/map-vue';
import { ElInput } from 'element-plus';
import { computed, defineComponent, nextTick, onScopeDispose, type PropType, ref, type VNode, watch } from 'vue';
import { BatchYearSelect } from '@/features/resource-map/components/BatchYearSelect';
import { hasLegendItems, LayerLegend } from '@/features/resource-map/components/LayerLegend';
import { LegendPreview } from '@/features/resource-map/components/LegendPreview';
import { ResourceLayerRow } from '@/features/resource-map/components/ResourceLayerRow';
import type { ResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import type { ResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import type { ResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import {
  currentLayers,
  resourceCatalogNodes,
  resourceCodeOfKey,
  resourceKey
} from '@/features/resource-map/layer-panel';
import { legendEntry } from '@/features/resource-map/legend';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import {
  type CatalogSelection,
  EMPTY_CATALOG_SELECTION,
  prunedSelection
} from '@/shared/map/layer-panel/catalog-selection';
import {
  allKeys,
  branchKeys,
  catalogCover,
  expandedByDefault,
  findCatalogNode
} from '@/shared/map/layer-panel/catalog-tree';
import { CatalogTree, type MenuPoint } from '@/shared/map/layer-panel/CatalogTree';
import { CurrentLayerGroup, type RowAnimation } from '@/shared/map/layer-panel/CurrentLayerGroup';
import { LayerPanelShell, type PanelFloatingContext } from '@/shared/map/layer-panel/LayerPanelShell';
import { LayerPopover } from '@/shared/map/layer-panel/LayerPopover';
import { type PanelMenuEntry, PanelMenu } from '@/shared/map/layer-panel/PanelMenu';
import { type PanelToolItem, PanelToolbar } from '@/shared/map/layer-panel/PanelToolbar';
import { revealInScroll } from '@/shared/map/layer-panel/scroll';
import { OpacitySlider } from '@/shared/map/OpacitySlider';
import { type MoveAction, moveIndex, selectionAfterRemoval, steppedKey } from './current-list';
import styles from './CurrentMapLayerPanel.module.scss';

// 头部的页签：统计报表、分节点资源先显示"暂无数据"（ADR 0053 第 6 节）
const TABS = [
  { id: 'core', label: '主节点' },
  { id: 'report', label: '统计报表' },
  { id: 'nodes', label: '分节点资源' }
] as const;

// 新加入的行滑入、定位到的行闪两下的时长，和样式里的动画一致
const ENTER_MS = 900;
const FLASH_MS = 1400;

/** 浮层：透明度或图例（用户 2026-11-14：两个分开，没有页签） */
type PopoverKind = 'opacity' | 'legend';

/** 开着的右键菜单：在目录还是当前图层上，右键的是哪一项，在哪里打开 */
interface PanelMenuState {
  readonly source: 'catalog' | 'current';
  readonly key: string;
  readonly point: MenuPoint;
}

/**
 * 现状底图的资源图层面板（ADR 0157）：上段"资源目录"找资源、加入和移出，下段"当前图层"管地图上的图层，共用工具栏操作选中的一行。
 * 把 resource-map 的目录、行、图例和 shared 的面板部件拼在一起；选中、浮层、菜单这些界面状态在这里，图层的状态在拥有者里
 */
export const CurrentMapLayerPanel = defineComponent({
  name: 'CurrentMapLayerPanel',
  props: {
    resources: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    layout: { type: Object as PropType<ResourcePanelLayout>, required: true },
    /** 资源目录的查询：还没到、加载失败 */
    status: { type: String as PropType<'ready' | 'loading' | 'failed'>, default: 'ready' },
    collapsed: { type: Boolean, default: false },
    /** 手机宽度：浮层盖在面板下段上 */
    sheet: { type: Boolean, default: false }
  },
  emits: {
    retry: () => true,
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean',
    /** 图例浮层正在显示的资源，右侧图例在编辑同一个资源时回到浏览；关闭时为 null */
    legendCode: (code: string | null) => code === null || typeof code === 'string'
  },
  setup(props, { emit }) {
    const map = useMap();
    const camera = map.useCamera();
    // 登记表的最小级别都是整数：只在跨级时更新行，不把显示层级的浮点容差用于可见性判断
    const level = computed(() => Math.floor(camera.value.zoom));
    const state = computed(() => props.resources.state.value);

    // ---------- 资源目录
    const keyword = ref('');
    const searching = computed(() => keyword.value.trim() !== '');
    const nodes = computed(() => resourceCatalogNodes(state.value, keyword.value));
    const expanded = ref<ReadonlySet<string>>(new Set());
    const selection = ref<CatalogSelection>(EMPTY_CATALOG_SELECTION);
    // 目录第一次到达时展开含有已加入资源的分类；之后目录刷新不改用户的展开
    watch(
      () => state.value.catalog,
      (catalog, previous) => {
        if (catalog && !previous) {
          expanded.value = expandedByDefault(resourceCatalogNodes(state.value));
        }
      },
      { immediate: true }
    );
    // 搜索掉的、目录里没有了的节点不再算选中
    watch(nodes, list => (selection.value = prunedSelection(selection.value, new Set(allKeys(list)))));
    const cover = computed(() => catalogCover(nodes.value, selection.value.keys));

    // ---------- 当前图层
    const layers = computed(() => currentLayers(state.value));
    const layerKeys = computed(() => layers.value.map(layer => resourceKey(layer.code)));
    const groupOpen = ref(true);
    const selected = ref<string | null>(null);
    const selectedCode = computed(() => (selected.value === null ? null : resourceCodeOfKey(selected.value)));
    const popover = ref<{ readonly kind: PopoverKind; readonly configuring: boolean } | null>(null);
    const menu = ref<PanelMenuState | null>(null);
    // 面板和当前图层滚动区的元素：外壳渲染浮层插槽时交出来，事件处理里找行用；不需要响应
    let floating: PanelFloatingContext | null = null;

    // 选中的行不在当前图层里了（别处移出、目录刷新）：没有选中，浮层关闭
    watch(layerKeys, keys => {
      if (selected.value !== null && !keys.includes(selected.value)) {
        selected.value = null;
      }
    });
    watch(selected, () => {
      if (selected.value === null) {
        popover.value = null;
      } else if (popover.value) {
        popover.value = { kind: popover.value.kind, configuring: false };
      }
    });
    watch(
      () => (popover.value?.kind === 'legend' ? selectedCode.value : null),
      code => emit('legendCode', code),
      { immediate: true }
    );

    // ---------- 动效
    const entering = ref<ReadonlySet<string>>(new Set());
    const flashing = ref<string | null>(null);
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, action: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        action();
      }, ms);
      timers.add(timer);
    };
    onScopeDispose(() => timers.forEach(timer => clearTimeout(timer)));
    const animationOf = (key: string): RowAnimation =>
      entering.value.has(key) ? 'entering' : flashing.value === key ? 'flash' : null;
    const flash = async (key: string) => {
      // 同一行再闪一次：先去掉再加上，动画从头开始
      flashing.value = null;
      await nextTick();
      flashing.value = key;
      later(FLASH_MS, () => {
        if (flashing.value === key) {
          flashing.value = null;
        }
      });
    };

    const rowElement = (key: string) =>
      floating?.list()?.querySelector<HTMLElement>(`[data-current-row="${CSS.escape(key)}"]`) ?? null;
    const scrollToRow = async (key: string, block: 'nearest' | 'center' = 'nearest') => {
      await nextTick();
      const row = rowElement(key);
      if (row) {
        revealInScroll(row, block);
      }
    };

    // ---------- 操作
    const choose = (key: string | null) => {
      selected.value = key;
    };

    const addKeys = (keys: readonly string[]) => {
      const codes = keys.flatMap(key => resourceCodeOfKey(key) ?? []);
      if (codes.length === 0) {
        return;
      }
      props.resources.add(codes);
      const added = new Set(codes.map(resourceKey));
      entering.value = new Set([...entering.value, ...added]);
      later(ENTER_MS, () => (entering.value = new Set([...entering.value].filter(key => !added.has(key)))));
      groupOpen.value = true;
      const [first] = codes;
      if (first !== undefined) {
        choose(resourceKey(first));
        void scrollToRow(resourceKey(first));
      }
    };

    const removeKeys = (keys: readonly string[]) => {
      const codes = keys.flatMap(key => resourceCodeOfKey(key) ?? []);
      if (codes.length === 0) {
        return;
      }
      const removed = new Set(codes.map(resourceKey));
      choose(selectionAfterRemoval(layerKeys.value, removed, selected.value));
      props.resources.remove(codes);
    };

    // 目录里的定位：在当前图层里选中、滚到中间、闪两下（用户 2026-11-14：双击改为定位）
    const locateInList = (key: string) => {
      if (!layerKeys.value.includes(key)) {
        return;
      }
      groupOpen.value = true;
      choose(key);
      void flash(key);
      void scrollToRow(key, 'center');
    };

    // 二维图层没有范围数据（后端给不出），只在没到最小显示级别时放大到那一级
    const locateTarget = (key: string | null): number | null => {
      const code = key === null ? null : resourceCodeOfKey(key);
      const minzoom = code === null ? undefined : props.resources.minzoomOf(code);
      return minzoom !== undefined && level.value < minzoom ? minzoom : null;
    };
    const locate = (key: string) => {
      const zoom = locateTarget(key);
      if (zoom !== null) {
        map.runCameraOperation(control => control.flyTo({ zoom }));
      }
    };

    const move = (key: string, action: MoveAction) => {
      const code = resourceCodeOfKey(key);
      const to = moveIndex(layerKeys.value, key, action);
      if (code !== null && to !== null) {
        props.resources.moveLayer(code, to);
        void scrollToRow(key);
      }
    };

    const togglePopover = (kind: PopoverKind) => {
      popover.value = popover.value?.kind === kind ? null : { kind, configuring: false };
    };

    const setVisible = (key: string, visible: boolean) => {
      const code = resourceCodeOfKey(key);
      if (code !== null) {
        props.resources.setVisible(code, visible);
      }
    };

    // ---------- 工具栏
    const catalogTools = computed((): PanelToolItem[] => {
      const adds = cover.value.add.length;
      const removes = cover.value.remove.length;
      return [
        {
          key: 'add',
          icon: 'layer-add',
          label: '添加到当前地图',
          tip: adds > 1 ? `添加 ${adds} 项` : '添加',
          disabled: adds === 0
        },
        {
          key: 'remove',
          icon: 'layer-remove',
          label: '从当前地图移除',
          tip: removes > 1 ? `移除 ${removes} 项` : '移除',
          disabled: removes === 0
        },
        'divider',
        { key: 'expand-all', icon: 'tree-expand-all', label: '展开全部分类', tip: '全部展开', disabled: searching.value },
        { key: 'collapse-all', icon: 'tree-collapse-all', label: '收起全部分类', tip: '全部收起', disabled: searching.value }
      ];
    });

    const onCatalogTool = (action: string) => {
      if (action === 'add') {
        addKeys(cover.value.add);
      } else if (action === 'remove') {
        removeKeys(cover.value.remove);
      } else if (action === 'expand-all') {
        expanded.value = new Set(branchKeys(nodes.value));
      } else if (action === 'collapse-all') {
        expanded.value = new Set();
      }
    };

    const currentTools = computed((): PanelToolItem[] => {
      const key = selected.value;
      const canMove = (action: MoveAction) => key !== null && moveIndex(layerKeys.value, key, action) !== null;
      const zoom = locateTarget(key);
      return [
        { key: 'move-up', icon: 'move-up', label: '图层上移', tip: '上移', disabled: !canMove('move-up') },
        { key: 'move-down', icon: 'move-down', label: '图层下移', tip: '下移', disabled: !canMove('move-down') },
        { key: 'move-top', icon: 'move-top', label: '图层置顶', tip: '置顶', disabled: !canMove('move-top') },
        { key: 'move-bottom', icon: 'move-bottom', label: '图层置底', tip: '置底', disabled: !canMove('move-bottom') },
        'divider',
        {
          key: 'opacity',
          icon: 'layer-opacity',
          label: '图层透明度',
          tip: '透明度',
          disabled: key === null,
          pressed: popover.value?.kind === 'opacity'
        },
        {
          key: 'legend',
          icon: 'map-legend',
          label: '图层图例',
          tip: '图例',
          disabled: key === null,
          pressed: popover.value?.kind === 'legend'
        },
        'divider',
        {
          key: 'locate',
          icon: 'focus',
          label: '定位图层',
          tip: zoom !== null ? `放大到第 ${zoom} 级` : key === null ? '定位' : '定位（图层已在可见级别）',
          disabled: zoom === null
        }
      ];
    });

    const onCurrentTool = (action: string) => {
      const key = selected.value;
      if (key === null) {
        return;
      }
      if (action === 'opacity' || action === 'legend') {
        togglePopover(action);
      } else if (action === 'locate') {
        locate(key);
      } else if (action === 'move-up' || action === 'move-down' || action === 'move-top' || action === 'move-bottom') {
        move(key, action);
      }
    };

    // ---------- 右键菜单
    const menuItems = computed((): PanelMenuEntry[] => {
      const current = menu.value;
      if (!current) {
        return [];
      }
      if (current.source === 'catalog') {
        const adds = cover.value.add.length;
        const removes = cover.value.remove.length;
        const node = findCatalogNode(nodes.value, current.key);
        const added = node?.kind === 'leaf' && node.added;
        return [
          {
            key: 'add',
            label: adds > 1 ? `添加 ${adds} 项` : '添加',
            icon: 'layer-add',
            disabled: adds === 0,
            shortcut: 'Insert'
          },
          {
            key: 'remove',
            label: removes > 1 ? `移除 ${removes} 项` : '移除',
            icon: 'layer-remove',
            disabled: removes === 0,
            shortcut: 'Delete'
          },
          'divider',
          {
            key: 'locate',
            label: '定位',
            icon: 'focus',
            disabled: !added,
            shortcut: node?.kind === 'leaf' ? '双击' : undefined
          }
        ];
      }
      const layer = layers.value.find(item => resourceKey(item.code) === current.key);
      const canMove = (action: MoveAction) => moveIndex(layerKeys.value, current.key, action) !== null;
      const zoom = locateTarget(current.key);
      return [
        {
          key: 'visible',
          label: layer?.visible ? '隐藏' : '显示',
          icon: layer?.visible ? 'eye-off' : 'eye',
          shortcut: '空格'
        },
        'divider',
        { key: 'opacity', label: '透明度', icon: 'layer-opacity' },
        { key: 'legend', label: '图例', icon: 'map-legend' },
        'divider',
        {
          key: 'locate',
          label: zoom !== null ? `放大到第 ${zoom} 级` : '定位',
          icon: 'focus',
          disabled: zoom === null,
          shortcut: '双击'
        },
        'divider',
        { key: 'move-up', label: '上移', icon: 'move-up', disabled: !canMove('move-up'), shortcut: 'Alt+↑' },
        { key: 'move-down', label: '下移', icon: 'move-down', disabled: !canMove('move-down'), shortcut: 'Alt+↓' },
        { key: 'move-top', label: '置顶', icon: 'move-top', disabled: !canMove('move-top') },
        { key: 'move-bottom', label: '置底', icon: 'move-bottom', disabled: !canMove('move-bottom') },
        'divider',
        { key: 'remove', label: '移除', icon: 'layer-remove', danger: true, shortcut: 'Delete' }
      ];
    });

    const onMenuSelect = (action: string) => {
      const current = menu.value;
      menu.value = null;
      if (!current) {
        return;
      }
      if (current.source === 'catalog') {
        if (action === 'add') {
          addKeys(cover.value.add);
        } else if (action === 'remove') {
          removeKeys(cover.value.remove);
        } else if (action === 'locate') {
          locateInList(current.key);
        }
        return;
      }
      const layer = layers.value.find(item => resourceKey(item.code) === current.key);
      if (action === 'visible') {
        setVisible(current.key, !layer?.visible);
      } else if (action === 'opacity' || action === 'legend') {
        choose(current.key);
        popover.value = { kind: action, configuring: false };
      } else if (action === 'remove') {
        removeKeys([current.key]);
      } else if (action === 'locate') {
        locate(current.key);
      } else if (action === 'move-up' || action === 'move-down' || action === 'move-top' || action === 'move-bottom') {
        move(current.key, action);
      }
    };

    // ---------- 渲染
    const renderCurrent = () => {
      if (layers.value.length === 0) {
        return <div class={styles.empty}>当前地图还没有图层</div>;
      }
      return (
        <CurrentLayerGroup
          group="layers"
          title="二维图层"
          open={groupOpen.value}
          keys={layerKeys.value}
          selected={selected.value}
          tabbable={selected.value ?? layerKeys.value[0] ?? null}
          visibleOf={key => layers.value.find(layer => resourceKey(layer.code) === key)?.visible ?? false}
          nameOf={key => layers.value.find(layer => resourceKey(layer.code) === key)?.name ?? key}
          animationOf={animationOf}
          dragTip="拖动调整叠放顺序（上层优先显示）"
          onUpdate:open={(open: boolean) => (groupOpen.value = open)}
          onSelect={choose}
          onStep={(key: string, delta: number) => {
            const next = steppedKey(layerKeys.value, key, delta);
            choose(next);
            void nextTick(() => rowElement(next)?.focus());
          }}
          onVisible={setVisible}
          onMove={(key: string, to: number) => {
            const code = resourceCodeOfKey(key);
            if (code !== null) {
              props.resources.moveLayer(code, to);
            }
          }}
          onActivate={locate}
          onRemove={(key: string) => removeKeys([key])}
          onMenu={(key: string, point: MenuPoint) => (menu.value = { source: 'current', key, point })}
        >
          {{
            row: ({ key }: { key: string }) => {
              const code = resourceCodeOfKey(key);
              return code === null
                ? []
                : [
                    <ResourceLayerRow
                      layers={props.resources}
                      symbols={props.symbols}
                      code={code}
                      level={level.value}
                      onLegend={() => {
                        const open = popover.value?.kind === 'legend' && selected.value === key;
                        choose(key);
                        popover.value = open ? null : { kind: 'legend', configuring: false };
                      }}
                      onRemove={() => removeKeys([key])}
                    />
                  ];
            }
          }}
        </CurrentLayerGroup>
      );
    };

    const renderPopover = (context: PanelFloatingContext): VNode | null => {
      const code = selectedCode.value;
      const current = popover.value;
      const resource = code === null ? undefined : state.value.catalog?.resources.get(code);
      const display = code === null ? undefined : state.value.displays.get(code);
      if (!current || code === null || !resource || !display) {
        return null;
      }
      const entry = legendEntry(resource, display.year, props.symbols.overrideOf(code));
      const legend = current.kind === 'legend';
      const configurable = legend && hasLegendItems(entry);
      return (
        <LayerPopover
          open
          panel={context.panel}
          list={context.list}
          anchor={() => (selected.value === null ? null : rowElement(selected.value))}
          sheet={props.sheet}
          width={legend ? 300 : 280}
          label={`${resource.name}的${legend ? '图例' : '透明度'}`}
          onClose={() => (popover.value = null)}
        >
          {{
            header: () => [
              <LegendPreview entry={entry} />,
              <span class={styles.popName} title={resource.name}>
                {resource.name}
              </span>,
              <span class={styles.popYear}>{display.year}</span>,
              ...(configurable
                ? [
                    <button
                      type="button"
                      class={styles.popButton}
                      aria-label="样式设置"
                      title="样式设置"
                      aria-pressed={current.configuring}
                      onClick={() => (popover.value = { kind: 'legend', configuring: !current.configuring })}
                    >
                      <SvgIcon name="symbol-settings" size={16} />
                    </button>
                  ]
                : []),
              <button
                type="button"
                class={styles.popButton}
                aria-label="关闭"
                title="关闭"
                onClick={() => (popover.value = null)}
              >
                <SvgIcon name="close" size={16} />
              </button>
            ],
            default: () =>
              legend
                ? [
                    <LayerLegend
                      layers={props.resources}
                      symbols={props.symbols}
                      code={code}
                      configuring={current.configuring}
                      onUpdate:configuring={(configuring: boolean) =>
                        (popover.value = { kind: 'legend', configuring })
                      }
                    />
                  ]
                : [
                    <OpacitySlider
                      value={display.opacity}
                      label={`${resource.name}的透明度`}
                      onChange={(value: number) => props.resources.setOpacity(code, value)}
                    />
                  ]
          }}
        </LayerPopover>
      );
    };

    return () => (
      <LayerPanelShell
        title="资源图层"
        tabs={TABS}
        status={props.status}
        collapsed={props.collapsed}
        ratio={props.layout.checkedRatio.value}
        onRetry={() => emit('retry')}
        onUpdate:collapsed={(collapsed: boolean) => emit('update:collapsed', collapsed)}
        onUpdate:ratio={(ratio: number) => props.layout.setCheckedRatio(ratio)}
      >
        {{
          catalogTools: () => [<PanelToolbar items={catalogTools.value} label="资源目录的操作" onAction={onCatalogTool} />],
          catalogFilter: () => [
            <ElInput
              class={styles.search}
              modelValue={keyword.value}
              clearable
              prefixIcon={Search}
              placeholder="搜索资源"
              ariaLabel="搜索资源"
              onUpdate:modelValue={(value: string) => (keyword.value = value)}
            />,
            <BatchYearSelect layers={props.resources} />
          ],
          catalog: () => [
            nodes.value.length > 0 ? (
              <CatalogTree
                nodes={nodes.value}
                expanded={expanded.value}
                selection={selection.value}
                searching={searching.value}
                label="资源目录"
                onUpdate:selection={(next: CatalogSelection) => (selection.value = next)}
                onUpdate:expanded={(next: ReadonlySet<string>) => (expanded.value = next)}
                onAdd={addKeys}
                onRemove={removeKeys}
                onLocate={locateInList}
                onMenu={(key: string, point: MenuPoint) => (menu.value = { source: 'catalog', key, point })}
              />
            ) : (
              <div class={styles.empty}>没有找到资源</div>
            )
          ],
          currentTools: () => [<PanelToolbar items={currentTools.value} label="当前图层的操作" onAction={onCurrentTool} />],
          current: () => [renderCurrent()],
          floating: (context: PanelFloatingContext) => {
            floating = context;
            const items: VNode[] = [];
            const pop = renderPopover(context);
            if (pop) {
              items.push(pop);
            }
            if (menu.value) {
              items.push(
                <PanelMenu
                  open
                  point={menu.value.point}
                  items={menuItems.value}
                  label={menu.value.source === 'catalog' ? '资源目录的菜单' : '当前图层的菜单'}
                  onSelect={onMenuSelect}
                  onClose={() => (menu.value = null)}
                />
              );
            }
            return items;
          }
        }}
      </LayerPanelShell>
    );
  }
});
