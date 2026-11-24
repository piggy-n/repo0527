import { Search } from '@element-plus/icons-vue';
import { useMap } from '@mx/map-vue';
import { ElButton, ElInput } from 'element-plus';
import { computed, defineComponent, nextTick, onScopeDispose, type PropType, ref, type VNode, watch } from 'vue';
import { BatchYearSelect } from '@/features/resource-map/components/BatchYearSelect';
import { LabelEditor } from '@/features/resource-map/components/LabelEditor';
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
import { labelFieldsOf } from '@/features/resource-map/label-fields';
import { fillOpacityOf, legendEntry } from '@/features/resource-map/legend';
import { ModelKindSelect } from '@/features/scene-models/components/ModelKindSelect';
import { ModelLayerRow } from '@/features/scene-models/components/ModelLayerRow';
import type { SceneModels } from '@/features/scene-models/composables/useSceneModels';
import {
  canRoamModel,
  modelCatalogNodes,
  modelCityNodes,
  modelIdOfKey,
  modelKey,
  roamUnavailable
} from '@/features/scene-models/layer-panel';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import {
  actionTargets,
  type CatalogSelection,
  EMPTY_CATALOG_SELECTION,
  isBatch,
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
import { CurrentLayerList, type RowAnimation } from '@/shared/map/layer-panel/CurrentLayerList';
import { LayerPanelShell, type PanelFloatingContext, type PanelTab } from '@/shared/map/layer-panel/LayerPanelShell';
import { LayerPopover } from '@/shared/map/layer-panel/LayerPopover';
import { type PanelMenuEntry, PanelMenu } from '@/shared/map/layer-panel/PanelMenu';
import type { ListSplit } from '@/shared/map/layer-panel/panel-split';
import { type PanelToolItem, PanelToolbar } from '@/shared/map/layer-panel/PanelToolbar';
import { revealInScroll } from '@/shared/map/layer-panel/scroll';
import { OpacitySlider } from '@/shared/map/OpacitySlider';
import type { RequestStatus } from '@/shared/map/request-status/useRequestStatus';
import { LAYER_HINTS, type LayerHint } from '@/shared/config/layer-hints';
import { COVER_OPACITY, type MoveAction, moveIndex, selectionAfterRemoval, steppedKey } from './current-list';
import styles from './CurrentMapLayerPanel.module.scss';
import { labelMenuEntries, type LabelRowState, labelToolItem } from './label-entries';
import { resourceStatusKindsOf } from './layer-hints';
import type { CurrentLayers } from './useCurrentLayers';

// 新加入的行滑入、定位到的行闪两下的时长，和样式里的动画一致
const ENTER_MS = 900;
const FLASH_MS = 1400;

/** 上段"资源"显示的内容（用户 2026-11-15）、三维里下段"图层"看哪一类（ADR 0161）：全部、只有二维资源、只有三维模型 */
type CatalogView = 'all' | 'resources' | 'models';

// 搜索行下面的标签：顺序固定（资源在模型前面，用户 2026-11-15 确认），默认项随维度变；
// 叫法用全称（用户 2026-11-16 选的丁：标签另起一行，放得下）。"图层"的标签同样的叫法和先后，默认"全部"
const CATALOG_VIEWS: readonly { readonly id: CatalogView; readonly label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'resources', label: '二维资源' },
  { id: 'models', label: '三维模型' }
];

const catalogViewOf = (id: string): CatalogView | undefined => CATALOG_VIEWS.find(item => item.id === id)?.id;

/** 浮层：透明度、图例或标注（用户 2026-11-14：分开，没有页签；标注是第三种，ADR 0160） */
type PopoverKind = 'opacity' | 'legend' | 'label';

const POPOVER_NAMES: Readonly<Record<PopoverKind, string>> = { opacity: '透明度', legend: '图例', label: '标注' };

/** 开着的右键菜单：在资源还是图层上，右键的是哪一项，在哪里打开 */
interface PanelMenuState {
  readonly source: 'catalog' | 'current';
  readonly key: string;
  readonly point: MenuPoint;
}

/** 定位能不能用：菜单的名称，不能用时的原因（菜单里代替快捷键显示） */
interface LocateInfo {
  readonly enabled: boolean;
  readonly label: string;
  readonly reason?: string;
}

type LoadStatus = 'ready' | 'loading' | 'failed';

/**
 * 现状底图的资源图层面板（ADR 0157），二三维共用：上段"资源"找资源和三维模型、加入和移出，下段"图层"把二维资源和三维模型平铺
 * 成一个列表、顺序就是叠放（ADR 0161），工具栏操作选中的一行（两段的叫法用户 2026-11-16 定）。把 resource-map、scene-models 的
 * 目录、行、图例和 shared 的面板部件拼在一起；选中、浮层、菜单、筛选这些界面状态在这里，平铺的顺序在页面的 CurrentLayers，
 * 图层和模型的状态在各自的拥有者里。二维里模型行留在原位、变淡，不能定位、不能漫游，其余操作照常（用户 2026-11-14、11-16）。
 * 三维里上段先体现模型（用户 2026-11-15 选的方案乙），下段标题下面有和上段一样的"全部、二维资源、三维模型"，筛选时也能排序。
 * 二维、三维各一套时（ADR 0169）二维的图层里没有模型：上段只列资源、没有标签，三维照旧
 */
export const CurrentMapLayerPanel = defineComponent({
  name: 'CurrentMapLayerPanel',
  props: {
    resources: { type: Object as PropType<ResourceLayers>, required: true },
    /** 平铺的图层（ADR 0161）：页面创建，地图按它放模型层 */
    current: { type: Object as PropType<CurrentLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    layout: { type: Object as PropType<ResourcePanelLayout>, required: true },
    models: { type: Object as PropType<SceneModels>, required: true },
    /** 资源目录的查询：还没到、加载失败；只挡住二维资源，三维模型照常（ADR 0157） */
    status: { type: String as PropType<LoadStatus>, default: 'ready' },
    /** 三维模型清单的查询：失败时目录最后提示、可以重试 */
    modelsStatus: { type: String as PropType<LoadStatus>, default: 'ready' },
    collapsed: { type: Boolean, default: false },
    /** 手机宽度：浮层盖在面板下段上 */
    sheet: { type: Boolean, default: false },
    /**
     * 地图数据的请求状态（ADR 0158、0162、0167）：资源行和模型行加载超过 0.4 秒时名称后面转圈，资源这一轮有瓦片失败时
     * 名称后面是失败的图标
     */
    requests: { type: Object as PropType<RequestStatus>, default: undefined },
    /** 行内提示显示哪几类（ADR 0167，部署时在 .env 里配，appConfig.layerHints）；不给时全显示 */
    hints: { type: Object as PropType<ReadonlySet<LayerHint>>, default: () => new Set(LAYER_HINTS) },
    /** 在图层里选中、滚到、闪一下这一行（请求状态的明细里点了一行）；每次给一个新对象 */
    reveal: { type: Object as PropType<{ readonly key: string } | null>, default: null },
    /** 右侧"图例"页正在编辑的资源：图例浮层开着同一个资源时关掉，后打开编辑的一方为准（ADR 0157） */
    legendYield: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    retry: () => true,
    retryModels: () => true,
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean',
    /** 图例浮层正在显示的资源，右侧图例在编辑同一个资源时回到浏览；关闭时为 null */
    legendCode: (code: string | null) => code === null || typeof code === 'string',
    /** 两段分到的高度变了（外壳的 layout）：页面上贴着面板放的浮层（数据加载的明细）读它重新放 */
    layout: (split: ListSplit | null) => split === null || typeof split === 'object'
  },
  setup(props, { emit }) {
    const map = useMap();
    const camera = map.useCamera();
    // 登记表的最小级别都是整数：只在跨级时更新行，不把显示层级的浮点容差用于可见性判断
    const level = computed(() => Math.floor(camera.value.zoom));
    const state = computed(() => props.resources.state.value);
    const scene = computed(() => map.dimension.value === '3d');
    const modelOf = (id: string) => props.models.models.value.find(model => model.id === id);

    // ---------- 资源（上段）
    const keyword = ref('');
    const searching = computed(() => keyword.value.trim() !== '');
    // 图层里不能有模型（二维、三维各一套时的二维，ADR 0169）：目录只有资源、没有标签
    const resourcesOnly = computed(() => !props.current.holdsModels.value);
    // 显示的内容、"三维模型"时的类型筛选：界面状态，不持久化；进入三维是"三维模型"，进入二维是"全部"（同以前的二维目录），
    // 二维里只有资源时固定是"二维资源"
    const defaultView = (): CatalogView => {
      if (resourcesOnly.value) {
        return 'resources';
      }
      return scene.value ? 'models' : 'all';
    };
    const view = ref<CatalogView>(defaultView());
    const modelKind = ref<string | null>(null);
    watch([scene, resourcesOnly], () => (view.value = defaultView()));
    const modelsView = computed(() => view.value === 'models');
    const resourceNodes = computed(() => resourceCatalogNodes(state.value, keyword.value));
    const cityNodes = computed(() =>
      modelCityNodes(props.models.models.value, props.models.added.value, keyword.value, modelKind.value)
    );
    const modelRootNodes = computed(() =>
      modelCatalogNodes(props.models.models.value, props.models.added.value, keyword.value)
    );
    // "三维模型"直接按市分组；"全部"里三维模型是一个分类，三维里在最上面、二维里在最后
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
    // 标签上的数量：这一项显示的资源和模型（不算分类），搜索时是匹配的项数，"三维模型"里也按类型筛选；代替以前列表下面
    // "还有 N 项匹配"的提示（用户 2026-11-16）。资源目录、模型清单还没到或读不到时，用到它的项不写数量。
    // 只有资源时没有标签，外壳不显示标签行（用户 2026-11-22，ADR 0169）
    const views = computed((): PanelTab[] => {
      if (resourcesOnly.value) {
        return [];
      }
      const resourcesReady = props.status === 'ready';
      const modelsReady = props.modelsStatus === 'ready';
      const readyOf = { all: resourcesReady && modelsReady, resources: resourcesReady, models: modelsReady };
      return CATALOG_VIEWS.map(({ id, label }) => ({
        id,
        label,
        count: readyOf[id] ? viewNodes(id).flatMap(leavesOf).length : null
      }));
    });
    const expanded = ref<ReadonlySet<string>>(new Set());
    // 第一次显示"三维模型"时展开各市，模型一眼能看到；之后不改用户的展开
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
    // 目录第一次到达时展开含有已加入资源的分类，并进已有的展开（模型清单可能先到，各市已经展开）；之后目录刷新不改用户的展开
    watch(
      () => state.value.catalog,
      (catalog, previous) => {
        if (catalog && !previous) {
          expanded.value = new Set([...expanded.value, ...expandedByDefault(resourceCatalogNodes(state.value))]);
        }
      },
      { immediate: true }
    );
    // 搜索掉的、目录里没有了的节点不再算选中
    watch(nodes, list => (selection.value = prunedSelection(selection.value, new Set(allKeys(list)))));
    const cover = computed(() => catalogCover(nodes.value, selection.value.keys));

    // ---------- 图层（下段）
    const layers = computed(() => currentLayers(state.value));
    // 平铺的行，从上到下就是叠放（ADR 0161）
    const currentKeys = computed(() => props.current.keys.value);
    // 三维里看哪一类：界面状态，不持久化；切换维度时回到"全部"，二维里不筛选
    const currentView = ref<CatalogView>('all');
    watch(scene, () => (currentView.value = 'all'));
    const inView = (key: string, which: CatalogView) =>
      which === 'all' || (which === 'models') === (modelIdOfKey(key) !== null);
    const filtering = computed(() => scene.value && currentView.value !== 'all');
    // 看得见的行：方向键换行、移动、Tab 都按它们算
    const shownKeys = computed(() =>
      filtering.value ? currentKeys.value.filter(key => inView(key, currentView.value)) : currentKeys.value
    );
    const currentViews = computed((): PanelTab[] =>
      scene.value
        ? CATALOG_VIEWS.map(({ id, label }) => ({
            id,
            label,
            count: currentKeys.value.filter(key => inView(key, id)).length
          }))
        : []
    );
    const selected = ref<string | null>(null);
    const selectedCode = computed(() => (selected.value === null ? null : resourceCodeOfKey(selected.value)));
    const popover = ref<{ readonly kind: PopoverKind; readonly configuring: boolean } | null>(null);
    const menu = ref<PanelMenuState | null>(null);
    // 面板和图层滚动区的元素：外壳渲染浮层插槽时交出来，事件处理里找行用；不需要响应
    let floating: PanelFloatingContext | null = null;

    // 选中的行不在图层里了（别处移出、目录刷新）或者被筛掉了：没有选中，浮层关闭
    watch(shownKeys, keys => {
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
    // 浮层的箭头对着选中的行。读显示的行的顺序：上移下移、筛选、别的行加入移出只更新面板里面的一层，浮层的属性不变、
    // 行还是那个元素，靠这里读到的状态让浮层重新放（2026-11-15、2026-11-14 审查发现）
    const popoverAnchor = (): HTMLElement | null => {
      const key = selected.value;
      if (key === null) {
        return null;
      }
      void shownKeys.value;
      return rowElement(key);
    };
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

    // 加入（ADR 0167）：后加入的不论模型还是资源都放在最上面；列表里最上面的新行被选中、滚到它，新行滑入。
    // 筛选着、新行会被筛掉时回到"全部"
    const addKeys = (keys: readonly string[]) => {
      const added = keys.flatMap(key =>
        resourceCodeOfKey(key) !== null || modelIdOfKey(key) !== null ? [key] : []
      );
      if (added.length === 0) {
        return;
      }
      props.current.add(added);
      if (filtering.value && added.some(key => !inView(key, currentView.value))) {
        currentView.value = 'all';
      }
      const fresh = new Set(added);
      const first = currentKeys.value.find(key => fresh.has(key));
      entering.value = new Set([...entering.value, ...fresh]);
      later(ENTER_MS, () => (entering.value = new Set([...entering.value].filter(key => !fresh.has(key)))));
      if (first !== undefined) {
        choose(first);
        void scrollToRow(first);
      }
    };

    const removeKeys = (keys: readonly string[]) => {
      const codes = keys.flatMap(key => resourceCodeOfKey(key) ?? []);
      const ids = keys.flatMap(key => modelIdOfKey(key) ?? []);
      if (codes.length === 0 && ids.length === 0) {
        return;
      }
      const removed = new Set([...codes.map(resourceKey), ...ids.map(modelKey)]);
      choose(selectionAfterRemoval(shownKeys.value, removed, selected.value));
      props.current.remove([...removed]);
    };

    // 目录里的定位（回车、右键菜单；2026-11-22 起单击是添加、移除，不再双击定位）：在图层里选中、滚到中间、闪两下；
    // 被筛掉时回到"全部"
    const locateInList = (key: string) => {
      if (!currentKeys.value.includes(key)) {
        return;
      }
      if (!shownKeys.value.includes(key)) {
        currentView.value = 'all';
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

    // 请求状态的明细里点了一行：在图层里选中、滚到、闪
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
          return { enabled: false, label: '定位', reason: '切换到三维后可用' };
        }
        return props.models.hidden.value.has(id)
          ? { enabled: false, label: '定位', reason: '显示后可用' }
          : { enabled: true, label: '定位' };
      }
      const zoom = locateTarget(key);
      if (zoom !== null) {
        return { enabled: true, label: `放大到第 ${zoom} 级` };
      }
      return { enabled: false, label: '定位', reason: key === null ? undefined : '已在可见级别' };
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

    // 移动按看得见的行算（ADR 0161）：to 是在它们里面的位置，被筛掉的行原地不动
    const moveTo = (key: string, to: number) => {
      props.current.move(key, to, shownKeys.value);
    };

    const move = (key: string, action: MoveAction) => {
      const to = moveIndex(shownKeys.value, key, action);
      if (to !== null) {
        moveTo(key, to);
        void scrollToRow(key);
      }
    };

    // 一行和标注有关的状态：模型没有标注，资源要登记了标注字段（ADR 0160）
    const labelRow = (key: string): LabelRowState => {
      const code = resourceCodeOfKey(key);
      return {
        model: code === null,
        labelable: code !== null && labelFieldsOf(code).length > 0,
        labeled: code !== null && state.value.displays.get(code)?.labeled === true
      };
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

    // 三维里会把模型盖住的面（ADR 0161 的 S4）：画在最上面那个模型上面、画在地图上（显示、到了最小级别）、有显示着的模型，
    // 有效不透明度（图层透明度 × 填充色的不透明度）不低于 COVER_OPACITY
    const coveringOf = (code: string) => {
      const resource = state.value.catalog?.resources.get(code);
      const display = state.value.displays.get(code);
      if (
        !scene.value ||
        !props.current.shownModel.value ||
        resource?.geometry !== 'fill' ||
        !display ||
        !props.current.overModels.value.includes(code) ||
        props.resources.sceneSlot([code]) === undefined ||
        level.value < (props.resources.minzoomOf(code) ?? 0)
      ) {
        return false;
      }
      const entry = legendEntry(resource, display.year, props.symbols.overrideOf(code));
      return display.opacity * fillOpacityOf(entry) >= COVER_OPACITY;
    };

    // 模型行尾的漫游、失败后的重新加载能不能用：同行内的按钮
    const roamable = (id: string) =>
      scene.value && !props.models.hidden.value.has(id) && props.models.stateOf(id) === 'ready';
    const modelFailed = (id: string) =>
      scene.value && !props.models.hidden.value.has(id) && props.models.stateOf(id) === 'failed';
    // 菜单里的"重新加载"跟着加载失败的提示（ADR 0167）：部署时关掉了，和行内的重试一起不出现
    const retryShown = (id: string) => props.hints.has('failed') && modelFailed(id);

    // ---------- 工具栏
    // 资源的批量添加、移除只在多选（两项以上）时出现（用户 2026-11-22），在展开、收起的左边，那两个按钮不动；
    // 添加、移除一起出现，做不了的灰着、写原因
    const catalogTools = computed((): PanelToolItem[] => {
      const treeTools: PanelToolItem[] = [
        { key: 'expand-all', icon: 'tree-expand-all', label: '展开全部分类', tip: '全部展开', disabled: searching.value },
        { key: 'collapse-all', icon: 'tree-collapse-all', label: '收起全部分类', tip: '全部收起', disabled: searching.value }
      ];
      if (!isBatch(selection.value)) {
        return treeTools;
      }
      const adds = cover.value.add.length;
      const removes = cover.value.remove.length;
      return [
        {
          key: 'add',
          icon: 'layer-add',
          label: '添加到当前地图',
          tip: adds > 0 ? `添加 ${adds} 项` : '选中的都已添加',
          disabled: adds === 0
        },
        {
          key: 'remove',
          icon: 'layer-remove',
          label: '从当前地图移除',
          tip: removes > 0 ? `移除 ${removes} 项` : '选中的都还没有添加',
          disabled: removes === 0
        },
        'divider',
        ...treeTools
      ];
    });

    const onCatalogTool = (action: string) => {
      if (action === 'add') {
        addKeys(cover.value.add);
      } else if (action === 'remove') {
        removeKeys(cover.value.remove);
      } else if (action === 'expand-all') {
        expanded.value = new Set([...expanded.value, ...branchKeys(nodes.value)]);
      } else if (action === 'collapse-all') {
        const shown = new Set(branchKeys(nodes.value));
        expanded.value = new Set([...expanded.value].filter(key => !shown.has(key)));
      }
    };

    const currentTools = computed((): PanelToolItem[] => {
      const key = selected.value;
      const model = key !== null && modelIdOfKey(key) !== null;
      // 按看得见的行（ADR 0161）；列表顺序就是叠放，模型和二维一样不另加说明
      const canMove = (action: MoveAction) => key !== null && moveIndex(shownKeys.value, key, action) !== null;
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
        // 第 8 个按钮：标题改成两个字后放得下（ADR 0160）
        labelToolItem(key === null ? null : labelRow(key), popover.value?.kind === 'label'),
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
      } else if (action === 'label' && labelRow(key).labelable) {
        togglePopover('label');
      } else if (action === 'remove-layer') {
        removeKeys([key]);
      } else if (action === 'move-up' || action === 'move-down' || action === 'move-top' || action === 'move-bottom') {
        move(key, action);
      }
    };

    // ---------- 右键菜单
    // 目录的菜单作用的项：右键分类时是它下面的，右键多选里的项时是整个选中，否则只是这一项
    const catalogMenuCover = (key: string) =>
      catalogCover(
        nodes.value,
        findCatalogNode(nodes.value, key)?.kind === 'branch' ? [key] : actionTargets(selection.value, key)
      );

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
            ? (['divider', { key: 'locate', label: '定位', icon: 'focus', disabled: !added, shortcut: '回车' }] satisfies PanelMenuEntry[])
            : [])
        ];
      }
      const visible = visibleOf(current.key);
      const canMove = (action: MoveAction) => moveIndex(shownKeys.value, current.key, action) !== null;
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
              ...labelMenuEntries(labelRow(current.key)),
              'divider'
            ] satisfies PanelMenuEntry[])
          : []),
        {
          key: 'locate',
          label: info.label,
          icon: 'focus',
          disabled: !info.enabled,
          shortcut: '双击',
          hint: info.reason
        },
        ...(id !== null && model && canRoamModel(model)
          ? [
              {
                key: 'roam',
                label: '漫游',
                icon: 'roam-walk',
                disabled: !roamable(id),
                hint: roamUnavailable(scene.value, props.models.hidden.value.has(id), props.models.stateOf(id) === 'ready')
              } satisfies PanelMenuEntry
            ]
          : []),
        ...(id !== null && retryShown(id)
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

    // 菜单关闭以后接过焦点的元素：打开菜单的那一行（键盘打开时不一定是选中的行），它被移除了是新选中的行；目录是打开菜单的那一项
    const menuReturn = (current: PanelMenuState) => (): HTMLElement | null => {
      if (current.source === 'current') {
        return rowElement(current.key) ?? (selected.value === null ? null : rowElement(selected.value));
      }
      return floating?.panel()?.querySelector<HTMLElement>(`[data-catalog-node="${CSS.escape(current.key)}"]`) ?? null;
    };

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
      } else if (action === 'label-visible' || action === 'label') {
        const code = resourceCodeOfKey(current.key);
        const row = labelRow(current.key);
        if (code === null || !row.labelable) {
          return;
        }
        if (action === 'label-visible') {
          props.resources.setLabeled(code, !row.labeled);
        } else {
          choose(current.key);
          popover.value = { kind: 'label', configuring: false };
        }
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

    // 部署时关掉的提示不显示（.env，ADR 0167）：转圈、瓦片失败已经按开关过滤，这里管模型的失败、状态图标和盖住模型
    const hintShown = (hint: LayerHint) => props.hints.has(hint);
    // 同一个数组交给每一行：每次渲染都新建的话，资源行跟着列表一起重渲染
    const statusKinds = computed(() => resourceStatusKindsOf(props.hints));
    const renderRow = (key: string) => {
      const id = modelIdOfKey(key);
      if (id !== null) {
        return [
          <ModelLayerRow
            models={props.models}
            id={id}
            scene={scene.value}
            loading={props.requests?.loadingKeys.value.has(key) ?? false}
            failureShown={hintShown('failed')}
            onRemove={() => removeKeys([key])}
          />
        ];
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
              tileFailed={props.requests?.failedKeys.value.has(key) ?? false}
              statusKinds={statusKinds.value}
              covering={hintShown('covering') && coveringOf(code)}
              onLegend={() => {
                const open = popover.value?.kind === 'legend' && selected.value === key;
                choose(key);
                popover.value = open ? null : { kind: 'legend', configuring: false };
              }}
              onRemove={() => removeKeys([key])}
            />
          ];
    };

    // 列表的：选中、方向键换行、显隐、定位、移除、右键
    const listHandlers = {
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
      if (shownKeys.value.length === 0) {
        return [<div class={styles.empty}>{currentView.value === 'models' ? '图层里没有三维模型' : '图层里没有二维资源'}</div>];
      }
      // 只有一行能用 Tab 进入：选中的，否则是第一行
      const tabbable =
        selected.value !== null && shownKeys.value.includes(selected.value) ? selected.value : (shownKeys.value[0] ?? null);
      // 二维里模型行留在原位、变淡，悬停说明在行里（用户 2026-11-16）；只剩模型时上面一行说明
      const onlyModels = currentKeys.value.every(key => modelIdOfKey(key) !== null);
      return [
        <CurrentLayerList
          label="图层"
          keys={shownKeys.value}
          selected={selected.value}
          tabbable={tabbable}
          visibleOf={visibleOf}
          nameOf={nameOf}
          animationOf={animationOf}
          dimmedOf={(key: string) => !scene.value && modelIdOfKey(key) !== null}
          note={!scene.value && onlyModels ? '三维模型切换到三维模式后显示' : undefined}
          dragTip="拖动调整叠放顺序（上层优先显示）"
          {...listHandlers}
        >
          {{ row: ({ key }: { key: string }) => renderRow(key) }}
        </CurrentLayerList>
      ];
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

    // 资源目录还没到或读不到："全部"里在资源的位置说明、可以重试，模型照常列出；"二维资源"由外壳整段说明。
    // 文字跟着上段叫"资源"（用户 2026-11-16）
    const renderResourcesStatus = (): VNode[] => {
      if (view.value !== 'all' || props.status === 'ready') {
        return [];
      }
      return [
        <div class={styles.notice} data-resources-status>
          {props.status === 'failed'
            ? [
                <span>资源加载失败</span>,
                <ElButton class="button-inline" link type="primary" size="small" onClick={() => emit('retry')}>
                  重试
                </ElButton>
              ]
            : [<span>正在加载资源…</span>]}
        </div>
      ];
    };

    const renderTree = (): VNode[] => [
      <CatalogTree
        nodes={nodes.value}
        expanded={expanded.value}
        selection={selection.value}
        searching={searching.value}
        label="资源"
        onUpdate:selection={(next: CatalogSelection) => (selection.value = next)}
        onUpdate:expanded={(next: ReadonlySet<string>) => (expanded.value = next)}
        onAdd={addKeys}
        onRemove={removeKeys}
        onLocate={locateInList}
        onMenu={(key: string, point: MenuPoint) => (menu.value = { source: 'catalog', key, point })}
      />
    ];

    // 资源在"全部"里的位置：三维里在模型后面，二维里在前面；目录是空的、又有这一行说明时不再写"没有找到"
    const renderCatalog = (): VNode[] => {
      const resourcesStatus = renderResourcesStatus();
      let body: VNode[] = [];
      if (nodes.value.length > 0) {
        body = renderTree();
      } else if (resourcesStatus.length === 0) {
        body = renderCatalogEmpty();
      }
      return scene.value ? [...body, ...resourcesStatus] : [...resourcesStatus, ...body];
    };

    // 模型清单读不到时目录里没有三维模型：在目录最后提示，可以重试（只看二维资源时不提示）
    const renderModelsFailed = (): VNode[] =>
      props.modelsStatus === 'failed' && view.value !== 'resources'
        ? [
            <div class={styles.notice} data-models-failed>
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
          layout={context.layout}
          anchor={popoverAnchor}
          sheet={props.sheet}
          width={current.kind === 'opacity' ? 280 : 300}
          label={`${resource.name}的${POPOVER_NAMES[current.kind]}`}
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
            default: () => {
              if (current.kind === 'label') {
                return [<LabelEditor layers={props.resources} symbols={props.symbols} code={code} />];
              }
              return legend
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
                  ];
            }
          }}
        </LayerPopover>
      );
    };

    return () => (
      <LayerPanelShell
        title="资源图层"
        status={view.value === 'resources' ? props.status : 'ready'}
        collapsed={props.collapsed}
        ratio={props.layout.checkedRatio.value}
        onRetry={() => emit('retry')}
        onUpdate:collapsed={(collapsed: boolean) => emit('update:collapsed', collapsed)}
        onUpdate:ratio={(ratio: number) => props.layout.setCheckedRatio(ratio)}
        onLayout={(split: ListSplit | null) => emit('layout', split)}
        views={views.value}
        view={view.value}
        onUpdate:view={(id: string) => (view.value = catalogViewOf(id) ?? view.value)}
        currentViews={currentViews.value}
        currentView={currentView.value}
        onUpdate:currentView={(id: string) => (currentView.value = catalogViewOf(id) ?? currentView.value)}
      >
        {{
          catalogTools: () => [<PanelToolbar items={catalogTools.value} label="资源的操作" onAction={onCatalogTool} />],
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
          catalog: () => [...renderCatalog(), ...renderModelsFailed()],
          currentTools: () => [<PanelToolbar items={currentTools.value} label="图层的操作" onAction={onCurrentTool} />],
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
                  label={menu.value.source === 'catalog' ? '资源的菜单' : '图层的菜单'}
                  returnFocus={menuReturn(menu.value)}
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
