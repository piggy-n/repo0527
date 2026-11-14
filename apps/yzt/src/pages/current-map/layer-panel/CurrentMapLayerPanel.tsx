import { Search } from '@element-plus/icons-vue';
import { useMap } from '@mx/map-vue';
import { ElButton, ElInput } from 'element-plus';
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
import { ModelKindSelect } from '@/features/scene-models/components/ModelKindSelect';
import { ModelLayerRow } from '@/features/scene-models/components/ModelLayerRow';
import type { SceneModels } from '@/features/scene-models/composables/useSceneModels';
import {
  canRoamModel,
  modelCatalogNodes,
  modelCityNodes,
  modelIdOfKey,
  modelKey
} from '@/features/scene-models/layer-panel';
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
  findCatalogNode,
  leavesOf
} from '@/shared/map/layer-panel/catalog-tree';
import { CatalogTree, type MenuPoint } from '@/shared/map/layer-panel/CatalogTree';
import { CurrentLayerGroup, type RowAnimation } from '@/shared/map/layer-panel/CurrentLayerGroup';
import { LayerPanelShell, type PanelFloatingContext } from '@/shared/map/layer-panel/LayerPanelShell';
import { LayerPopover } from '@/shared/map/layer-panel/LayerPopover';
import { type PanelMenuEntry, PanelMenu } from '@/shared/map/layer-panel/PanelMenu';
import { type PanelToolItem, PanelToolbar } from '@/shared/map/layer-panel/PanelToolbar';
import { revealInScroll } from '@/shared/map/layer-panel/scroll';
import { OpacitySlider } from '@/shared/map/OpacitySlider';
import type { RequestStatus } from '@/shared/map/request-status/useRequestStatus';
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

/** 资源目录显示的内容（用户 2026-11-15）：全部、只有三维模型、只有二维资源 */
type CatalogView = 'all' | 'models' | 'resources';

// 标题后面的页签：顺序固定，默认项随维度变；标题行只放得下两个字
const CATALOG_VIEWS: readonly { readonly id: CatalogView; readonly label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'models', label: '模型' },
  { id: 'resources', label: '资源' }
];

const catalogViewOf = (id: string): CatalogView | undefined => CATALOG_VIEWS.find(item => item.id === id)?.id;

/** 浮层：透明度或图例（用户 2026-11-14：两个分开，没有页签） */
type PopoverKind = 'opacity' | 'legend';

/** 开着的右键菜单：在目录还是当前图层上，右键的是哪一项，在哪里打开 */
interface PanelMenuState {
  readonly source: 'catalog' | 'current';
  readonly key: string;
  readonly point: MenuPoint;
}

/** 定位能不能用：工具栏的提示、菜单的名称 */
interface LocateInfo {
  readonly enabled: boolean;
  readonly tip: string;
  readonly label: string;
}

type LoadStatus = 'ready' | 'loading' | 'failed';

/**
 * 现状底图的资源图层面板（ADR 0157），二三维共用：上段"资源目录"找资源和三维模型、加入和移出，下段"当前图层"分"二维图层"
 * "三维模型"两组管地图上的内容，共用工具栏操作选中的一行。把 resource-map、scene-models 的目录、行、图例和 shared 的面板部件
 * 拼在一起；选中、浮层、菜单这些界面状态在这里，图层和模型的状态在各自的拥有者里。二维里模型组变淡、标"仅三维"，模型不能定位、
 * 不能漫游，其余操作照常（用户 2026-11-14 交给会话定）。三维里先体现模型（用户 2026-11-15 选的方案乙，分页按方案一做成
 * 标题后面的"全部、模型、资源"）：进入三维时目录只显示模型，当前图层里模型组在上
 */
export const CurrentMapLayerPanel = defineComponent({
  name: 'CurrentMapLayerPanel',
  props: {
    resources: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    layout: { type: Object as PropType<ResourcePanelLayout>, required: true },
    models: { type: Object as PropType<SceneModels>, required: true },
    /** 资源目录的查询：还没到、加载失败 */
    status: { type: String as PropType<LoadStatus>, default: 'ready' },
    /** 三维模型清单的查询：失败时目录最后提示、可以重试 */
    modelsStatus: { type: String as PropType<LoadStatus>, default: 'ready' },
    collapsed: { type: Boolean, default: false },
    /** 手机宽度：浮层盖在面板下段上 */
    sheet: { type: Boolean, default: false },
    /** 地图数据的请求状态（ADR 0158）：二维图层加载超过 0.4 秒时行内转圈 */
    requests: { type: Object as PropType<RequestStatus>, default: undefined },
    /** 在当前图层里选中、滚到、闪一下这一行（请求状态的明细里点了一行）；每次给一个新对象 */
    reveal: { type: Object as PropType<{ readonly key: string } | null>, default: null },
    /** 右侧"图例"页正在编辑的资源：图例浮层开着同一个资源时关掉，后打开编辑的一方为准（ADR 0157） */
    legendYield: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    retry: () => true,
    retryModels: () => true,
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
    const scene = computed(() => map.dimension.value === '3d');
    const modelOf = (id: string) => props.models.models.value.find(model => model.id === id);

    // ---------- 资源目录
    const keyword = ref('');
    const searching = computed(() => keyword.value.trim() !== '');
    // 目录显示的内容、"模型"时的类型筛选：界面状态，不持久化；进入三维是"模型"，进入二维是"全部"（同以前的二维目录）
    const view = ref<CatalogView>(scene.value ? 'models' : 'all');
    const modelKind = ref<string | null>(null);
    watch(scene, value => (view.value = value ? 'models' : 'all'));
    const modelsView = computed(() => view.value === 'models');
    const resourceNodes = computed(() => resourceCatalogNodes(state.value, keyword.value));
    const cityNodes = computed(() =>
      modelCityNodes(props.models.models.value, props.models.added.value, keyword.value, modelKind.value)
    );
    const modelRootNodes = computed(() =>
      modelCatalogNodes(props.models.models.value, props.models.added.value, keyword.value)
    );
    // "模型"直接按市分组；"全部"里三维模型是一个分类，三维里在最上面、二维里在最后
    const viewNodes = (which: CatalogView) => {
      if (which === 'models') {
        return cityNodes.value;
      }
      if (which === 'resources') {
        return resourceNodes.value;
      }
      return scene.value
        ? [...modelRootNodes.value, ...resourceNodes.value]
        : [...resourceNodes.value, ...modelRootNodes.value];
    };
    const nodes = computed(() => viewNodes(view.value));
    // "模型""资源"只搜这一项；另一项也有匹配时在列表下面提示，点了切过去
    const otherView = computed((): CatalogView | null =>
      view.value === 'models' ? 'resources' : view.value === 'resources' ? 'models' : null
    );
    const otherMatches = computed(() =>
      otherView.value !== null && searching.value ? viewNodes(otherView.value).flatMap(leavesOf).length : 0
    );
    const expanded = ref<ReadonlySet<string>>(new Set());
    // 第一次显示"模型"时展开各市，模型一眼能看到；之后不改用户的展开
    let citiesOpened = false;
    watch(
      () => (modelsView.value ? branchKeys(cityNodes.value) : []),
      keys => {
        if (!citiesOpened && keys.length > 0) {
          citiesOpened = true;
          expanded.value = new Set([...expanded.value, ...keys]);
        }
      },
      { immediate: true }
    );
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
    // 拥有者的目录里还有的模型（清单刷新后没有了的不显示）
    const modelKeys = computed(() =>
      props.models.added.value.flatMap(id => (modelOf(id) ? [modelKey(id)] : []))
    );
    const layersOpen = ref(true);
    const modelsOpen = ref(true);
    // 只有二维图层或只有三维模型时不显示组标题，这一组一直展开（用户 2026-11-15）
    const single = computed(() => layerKeys.value.length === 0 || modelKeys.value.length === 0);
    // 两组按显示的先后接在一起，三维里三维模型在上（方案乙）；方向键跨组时只走展开着的组
    const inGroupOrder = <T,>(layersPart: readonly T[], modelsPart: readonly T[]) =>
      scene.value ? [...modelsPart, ...layersPart] : [...layersPart, ...modelsPart];
    const currentKeys = computed(() => inGroupOrder(layerKeys.value, modelKeys.value));
    const shownKeys = computed(() =>
      inGroupOrder(
        layersOpen.value || single.value ? layerKeys.value : [],
        modelsOpen.value || single.value ? modelKeys.value : []
      )
    );
    const groupKeysOf = (key: string) => (modelIdOfKey(key) === null ? layerKeys.value : modelKeys.value);
    const selected = ref<string | null>(null);
    const selectedCode = computed(() => (selected.value === null ? null : resourceCodeOfKey(selected.value)));
    const popover = ref<{ readonly kind: PopoverKind; readonly configuring: boolean } | null>(null);
    const menu = ref<PanelMenuState | null>(null);
    // 面板和当前图层滚动区的元素：外壳渲染浮层插槽时交出来，事件处理里找行用；不需要响应
    let floating: PanelFloatingContext | null = null;

    // 选中的行不在当前图层里了（别处移出、目录刷新）：没有选中，浮层关闭
    watch(currentKeys, keys => {
      if (selected.value !== null && !keys.includes(selected.value)) {
        selected.value = null;
      }
    });
    // 浮层跟着换到选中的一项；模型没有透明度和图例，选中模型时关闭
    watch(selected, () => {
      if (selectedCode.value === null) {
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

    // 加入：资源、模型各自整批放在本组最上面；第一个新行被选中、滚到它，新行滑入
    const addKeys = (keys: readonly string[]) => {
      const codes = keys.flatMap(key => resourceCodeOfKey(key) ?? []);
      const ids = keys.flatMap(key => modelIdOfKey(key) ?? []);
      const added = [...codes.map(resourceKey), ...ids.map(modelKey)];
      const [first] = added;
      if (first === undefined) {
        return;
      }
      if (codes.length > 0) {
        props.resources.add(codes);
        layersOpen.value = true;
      }
      if (ids.length > 0) {
        props.models.add(ids);
        modelsOpen.value = true;
      }
      const fresh = new Set(added);
      entering.value = new Set([...entering.value, ...fresh]);
      later(ENTER_MS, () => (entering.value = new Set([...entering.value].filter(key => !fresh.has(key)))));
      choose(first);
      void scrollToRow(first);
    };

    const removeKeys = (keys: readonly string[]) => {
      const codes = keys.flatMap(key => resourceCodeOfKey(key) ?? []);
      const ids = keys.flatMap(key => modelIdOfKey(key) ?? []);
      if (codes.length === 0 && ids.length === 0) {
        return;
      }
      const removed = new Set([...codes.map(resourceKey), ...ids.map(modelKey)]);
      choose(selectionAfterRemoval(currentKeys.value, removed, selected.value));
      if (codes.length > 0) {
        props.resources.remove(codes);
      }
      if (ids.length > 0) {
        props.models.remove(ids);
      }
    };

    // 目录里的定位：在当前图层里选中、滚到中间、闪两下（用户 2026-11-14：双击改为定位）
    const locateInList = (key: string) => {
      if (!currentKeys.value.includes(key)) {
        return;
      }
      if (modelIdOfKey(key) === null) {
        layersOpen.value = true;
      } else {
        modelsOpen.value = true;
      }
      choose(key);
      void flash(key);
      void scrollToRow(key, 'center');
    };

    watch(
      () => props.legendYield,
      code => {
        if (code !== null && popover.value?.kind === 'legend' && selectedCode.value === code) {
          popover.value = null;
        }
      }
    );

    watch(
      () => props.reveal,
      request => {
        if (request) {
          locateInList(request.key);
        }
      }
    );

    // 二维图层没有范围数据（后端给不出），只在没到最小显示级别时放大到那一级
    const locateTarget = (key: string | null): number | null => {
      const code = key === null ? null : resourceCodeOfKey(key);
      const minzoom = code === null ? undefined : props.resources.minzoomOf(code);
      return minzoom !== undefined && level.value < minzoom ? minzoom : null;
    };
    // 模型只在三维里、显示着时飞过去，还没加载完的等加载完（用户 2026-11-14：二维里不能定位模型）
    const locateInfo = (key: string | null): LocateInfo => {
      const id = key === null ? null : modelIdOfKey(key);
      if (id !== null) {
        if (!scene.value) {
          return { enabled: false, tip: '定位（切换到三维后可用）', label: '定位' };
        }
        return props.models.hidden.value.has(id)
          ? { enabled: false, tip: '定位（显示后可用）', label: '定位' }
          : { enabled: true, tip: '定位', label: '定位' };
      }
      const zoom = locateTarget(key);
      if (zoom !== null) {
        return { enabled: true, tip: `放大到第 ${zoom} 级`, label: `放大到第 ${zoom} 级` };
      }
      return { enabled: false, tip: key === null ? '定位' : '定位（图层已在可见级别）', label: '定位' };
    };
    const locate = (key: string) => {
      if (!locateInfo(key).enabled) {
        return;
      }
      const id = modelIdOfKey(key);
      const zoom = locateTarget(key);
      if (id !== null) {
        props.models.locate(id);
      } else if (zoom !== null) {
        map.runCameraOperation(control => control.flyTo({ zoom }));
      }
    };

    const moveTo = (key: string, to: number) => {
      const id = modelIdOfKey(key);
      const code = resourceCodeOfKey(key);
      if (id !== null) {
        props.models.moveModel(id, to);
      } else if (code !== null) {
        props.resources.moveLayer(code, to);
      }
    };

    const move = (key: string, action: MoveAction) => {
      const to = moveIndex(groupKeysOf(key), key, action);
      if (to !== null) {
        moveTo(key, to);
        void scrollToRow(key);
      }
    };

    const togglePopover = (kind: PopoverKind) => {
      popover.value = popover.value?.kind === kind ? null : { kind, configuring: false };
    };

    const setVisible = (key: string, visible: boolean) => {
      const id = modelIdOfKey(key);
      const code = resourceCodeOfKey(key);
      if (id !== null) {
        props.models.setVisible(id, visible);
      } else if (code !== null) {
        props.resources.setVisible(code, visible);
      }
    };

    const visibleOf = (key: string) => {
      const id = modelIdOfKey(key);
      return id === null
        ? (layers.value.find(layer => resourceKey(layer.code) === key)?.visible ?? false)
        : !props.models.hidden.value.has(id);
    };

    // 模型行尾的漫游、失败后的重新加载能不能用：同行内的按钮
    const roamable = (id: string) =>
      scene.value && !props.models.hidden.value.has(id) && props.models.stateOf(id) === 'ready';
    const modelFailed = (id: string) =>
      scene.value && !props.models.hidden.value.has(id) && props.models.stateOf(id) === 'failed';

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
      const model = key !== null && modelIdOfKey(key) !== null;
      const canMove = (action: MoveAction) => key !== null && moveIndex(groupKeysOf(key), key, action) !== null;
      // 模型的先后只影响列表，遮挡按模型在空间里的位置
      const note = model ? '（只改列表顺序）' : '';
      return [
        { key: 'move-up', icon: 'move-up', label: '图层上移', tip: `上移${note}`, disabled: !canMove('move-up') },
        { key: 'move-down', icon: 'move-down', label: '图层下移', tip: `下移${note}`, disabled: !canMove('move-down') },
        { key: 'move-top', icon: 'move-top', label: '图层置顶', tip: `置顶${note}`, disabled: !canMove('move-top') },
        {
          key: 'move-bottom',
          icon: 'move-bottom',
          label: '图层置底',
          tip: `置底${note}`,
          disabled: !canMove('move-bottom')
        },
        'divider',
        {
          key: 'opacity',
          icon: 'layer-opacity',
          label: '图层透明度',
          tip: model ? '三维模型没有透明度' : '透明度',
          disabled: key === null || model,
          pressed: popover.value?.kind === 'opacity'
        },
        {
          key: 'legend',
          icon: 'map-legend',
          label: '图层图例',
          tip: model ? '三维模型没有图例' : '图例',
          disabled: key === null || model,
          pressed: popover.value?.kind === 'legend'
        },
        'divider',
        { key: 'remove-layer', icon: 'layer-remove', label: '移除图层', tip: '移除', disabled: key === null }
      ];
    });

    const onCurrentTool = (action: string) => {
      const key = selected.value;
      if (key === null) {
        return;
      }
      if ((action === 'opacity' || action === 'legend') && resourceCodeOfKey(key) !== null) {
        togglePopover(action);
      } else if (action === 'remove-layer') {
        removeKeys([key]);
      } else if (action === 'move-up' || action === 'move-down' || action === 'move-top' || action === 'move-bottom') {
        move(key, action);
      }
    };

    // ---------- 右键菜单
    // 目录的菜单作用的项：右键分类时是它下面的，右键项时是选中的
    const catalogMenuCover = (key: string) =>
      findCatalogNode(nodes.value, key)?.kind === 'branch' ? catalogCover(nodes.value, new Set([key])) : cover.value;

    const menuItems = computed((): PanelMenuEntry[] => {
      const current = menu.value;
      if (!current) {
        return [];
      }
      if (current.source === 'catalog') {
        const menuCover = catalogMenuCover(current.key);
        const adds = menuCover.add.length;
        const removes = menuCover.remove.length;
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
          ...(node?.kind === 'leaf'
            ? (['divider', { key: 'locate', label: '定位', icon: 'focus', disabled: !added, shortcut: '双击' }] satisfies PanelMenuEntry[])
            : [])
        ];
      }
      const visible = visibleOf(current.key);
      const canMove = (action: MoveAction) => moveIndex(groupKeysOf(current.key), current.key, action) !== null;
      const info = locateInfo(current.key);
      const id = modelIdOfKey(current.key);
      const model = id === null ? undefined : modelOf(id);
      return [
        { key: 'visible', label: visible ? '隐藏' : '显示', icon: visible ? 'eye-off' : 'eye', shortcut: '空格' },
        'divider',
        ...(id === null
          ? ([
              { key: 'opacity', label: '透明度', icon: 'layer-opacity' },
              { key: 'legend', label: '图例', icon: 'map-legend' },
              'divider'
            ] satisfies PanelMenuEntry[])
          : []),
        { key: 'locate', label: info.label, icon: 'focus', disabled: !info.enabled, shortcut: '双击' },
        ...(id !== null && model && canRoamModel(model)
          ? [{ key: 'roam', label: '漫游', icon: 'roam-walk', disabled: !roamable(id) } satisfies PanelMenuEntry]
          : []),
        ...(id !== null && modelFailed(id)
          ? [{ key: 'retry', label: '重新加载', icon: 'undo' } satisfies PanelMenuEntry]
          : []),
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
        const menuCover = catalogMenuCover(current.key);
        if (action === 'add') {
          addKeys(menuCover.add);
        } else if (action === 'remove') {
          removeKeys(menuCover.remove);
        } else if (action === 'locate') {
          locateInList(current.key);
        }
        return;
      }
      const id = modelIdOfKey(current.key);
      if (action === 'visible') {
        setVisible(current.key, !visibleOf(current.key));
      } else if ((action === 'opacity' || action === 'legend') && id === null) {
        choose(current.key);
        popover.value = { kind: action, configuring: false };
      } else if (action === 'roam' && id !== null && roamable(id)) {
        props.models.startRoam(id);
      } else if (action === 'retry' && id !== null) {
        props.models.retry(id);
      } else if (action === 'remove') {
        removeKeys([current.key]);
      } else if (action === 'locate') {
        locate(current.key);
      } else if (action === 'move-up' || action === 'move-down' || action === 'move-top' || action === 'move-bottom') {
        move(current.key, action);
      }
    };

    // ---------- 渲染
    const nameOf = (key: string) => {
      const id = modelIdOfKey(key);
      return id === null
        ? (layers.value.find(layer => resourceKey(layer.code) === key)?.name ?? key)
        : (modelOf(id)?.name ?? key);
    };

    const renderRow = (key: string) => {
      const id = modelIdOfKey(key);
      if (id !== null) {
        return [<ModelLayerRow models={props.models} id={id} scene={scene.value} onRemove={() => removeKeys([key])} />];
      }
      const code = resourceCodeOfKey(key);
      return code === null
        ? []
        : [
            <ResourceLayerRow
              layers={props.resources}
              symbols={props.symbols}
              code={code}
              level={level.value}
              loading={props.requests?.loadingKeys.value.has(key) ?? false}
              onLegend={() => {
                const open = popover.value?.kind === 'legend' && selected.value === key;
                choose(key);
                popover.value = open ? null : { kind: 'legend', configuring: false };
              }}
              onRemove={() => removeKeys([key])}
            />
          ];
    };

    // 两组共用的：选中、方向键跨组、显隐、定位、移除、右键
    const groupHandlers = {
      onSelect: choose,
      onStep: (key: string, delta: number) => {
        const next = steppedKey(shownKeys.value, key, delta);
        choose(next);
        void nextTick(() => rowElement(next)?.focus());
      },
      onVisible: setVisible,
      onMove: moveTo,
      onActivate: locate,
      // 键盘的 Delete：移除的行带着焦点卸掉了，焦点给新选中的行
      onRemove: (key: string) => {
        removeKeys([key]);
        void nextTick(() => (selected.value === null ? null : rowElement(selected.value))?.focus());
      },
      onMenu: (key: string, point: MenuPoint) => (menu.value = { source: 'current', key, point })
    };

    const renderCurrent = (): VNode[] => {
      if (currentKeys.value.length === 0) {
        return [<div class={styles.empty}>当前地图还没有图层</div>];
      }
      // 只有一行能用 Tab 进入：选中的（在收起的组里时不算），否则是第一行
      const tabbable =
        selected.value !== null && shownKeys.value.includes(selected.value) ? selected.value : (shownKeys.value[0] ?? null);
      const common = {
        selected: selected.value,
        tabbable,
        visibleOf,
        nameOf,
        animationOf,
        ...groupHandlers
      };
      const layersGroup: VNode[] = [];
      if (layerKeys.value.length > 0) {
        layersGroup.push(
          <CurrentLayerGroup
            key="layers"
            group="layers"
            title="二维图层"
            open={layersOpen.value || single.value}
            headless={single.value}
            keys={layerKeys.value}
            dragTip="拖动调整叠放顺序（上层优先显示）"
            onUpdate:open={(open: boolean) => (layersOpen.value = open)}
            {...common}
          >
            {{ row: ({ key }: { key: string }) => renderRow(key) }}
          </CurrentLayerGroup>
        );
      }
      // 二维里整组变淡，标题旁标一次"仅三维"，不在每一行上写
      const modelsGroup: VNode[] = [];
      if (modelKeys.value.length > 0) {
        modelsGroup.push(
          <CurrentLayerGroup
            key="models"
            group="models"
            title="三维模型"
            tag={scene.value ? undefined : '仅三维'}
            dimmed={!scene.value}
            open={modelsOpen.value || single.value}
            headless={single.value}
            keys={modelKeys.value}
            dragTip="拖动调整列表顺序"
            onUpdate:open={(open: boolean) => (modelsOpen.value = open)}
            {...common}
          >
            {{ row: ({ key }: { key: string }) => renderRow(key) }}
          </CurrentLayerGroup>
        );
      }
      return inGroupOrder(layersGroup, modelsGroup);
    };

    // 目录是空的：三维模型页按清单的状态说明（失败时由下面的提示说明），其余是没有找到
    const renderCatalogEmpty = (): VNode[] => {
      if (!modelsView.value) {
        return [<div class={styles.empty}>没有找到资源</div>];
      }
      if (props.modelsStatus === 'failed') {
        return [];
      }
      return [<div class={styles.empty}>{props.modelsStatus === 'loading' ? '三维模型清单加载中' : '没有找到模型'}</div>];
    };

    const renderCatalog = (): VNode[] =>
      nodes.value.length === 0
        ? renderCatalogEmpty()
        : [
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
          ];

    const renderOtherMatches = (): VNode[] =>
      otherMatches.value > 0
        ? [
            <button
              type="button"
              class={styles.otherView}
              data-other-view
              onClick={() => (view.value = otherView.value ?? view.value)}
            >
              {`${otherView.value === 'models' ? '三维模型' : '二维资源'}里还有 ${otherMatches.value} 项匹配`}
            </button>
          ]
        : [];

    // 模型清单读不到时目录里没有三维模型：在目录最后提示，可以重试（只看资源时不提示）
    const renderModelsFailed = (): VNode[] =>
      props.modelsStatus === 'failed' && view.value !== 'resources'
        ? [
            <div class={styles.modelsFailed} data-models-failed>
              <span>三维模型清单加载失败</span>
              <ElButton class="button-inline" link type="primary" size="small" onClick={() => emit('retryModels')}>
                重试
              </ElButton>
            </div>
          ]
        : [];

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
        views={CATALOG_VIEWS}
        view={view.value}
        onUpdate:view={(id: string) => (view.value = catalogViewOf(id) ?? view.value)}
      >
        {{
          catalogTools: () => [<PanelToolbar items={catalogTools.value} label="资源目录的操作" onAction={onCatalogTool} />],
          catalogFilter: () => [
            <ElInput
              class={styles.search}
              modelValue={keyword.value}
              clearable
              prefixIcon={Search}
              placeholder={modelsView.value ? '搜索模型或城市' : '搜索资源'}
              ariaLabel={modelsView.value ? '搜索模型或城市' : '搜索资源'}
              onUpdate:modelValue={(value: string) => (keyword.value = value)}
            />,
            modelsView.value ? (
              <ModelKindSelect
                models={props.models.models.value}
                kind={modelKind.value}
                onUpdate:kind={(kind: string | null) => (modelKind.value = kind)}
              />
            ) : (
              <BatchYearSelect layers={props.resources} />
            )
          ],
          catalog: () => [...renderCatalog(), ...renderOtherMatches(), ...renderModelsFailed()],
          currentTools: () => [<PanelToolbar items={currentTools.value} label="当前图层的操作" onAction={onCurrentTool} />],
          current: () => renderCurrent(),
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
