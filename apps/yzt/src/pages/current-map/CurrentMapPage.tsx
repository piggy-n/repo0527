import { useEventListener } from '@vueuse/core';
import { BROWSE_TOOL, type StyleGroup, type ViewKind } from '@mx/map-core';
import { MapCanvas, type MapViewport, provideMap, usePageActive, useShownElementSize } from '@mx/map-vue';
import { BoxSelectOverlay, MeasureOverlay, useMeasure } from '@mx/map-tools';
import { computed, defineComponent, KeepAlive, ref, shallowRef, watch } from 'vue';
import { FeatureDetailWindow } from '@/features/resource-map/components/FeatureDetailWindow';
import { ResourceLegend } from '@/features/resource-map/components/ResourceLegend';
import { ResourceLegendReset } from '@/features/resource-map/components/ResourceLegendReset';
import { useFeaturePick } from '@/features/resource-map/composables/useFeaturePick';
import { useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { resourceRequests } from '@/features/resource-map/layer-panel';
import { printEntries, renderedClasses, resourcePrintBlocks } from '@/features/resource-map/print-legend';
import { useResourceCatalogQuery } from '@/features/resource-map/queries';
import { roamPlaceOf } from '@/features/scene-models/catalog';
import { modelPrintBlock, printedModels } from '@/features/scene-models/print-legend';
import { IndoorMapDialog } from '@/features/scene-models/components/IndoorMapDialog';
import { IndoorMinimap } from '@/features/scene-models/components/IndoorMinimap';
import { RoamPanel } from '@/features/scene-models/components/RoamPanel';
import { useSceneModels } from '@/features/scene-models/composables/useSceneModels';
import { modelIdOfKey, modelRequests } from '@/features/scene-models/layer-panel';
import { useSceneModelsQuery } from '@/features/scene-models/queries';
import { appConfig } from '@/shared/config/app-config';
import { JIANGSU_MAP_OPTIONS } from '@/shared/map/backend-request';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { BasemapCard } from '@/shared/map/basemap/BasemapCard';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { boundaryPrintBlock } from '@/shared/map/boundary/boundary-print';
import { BoundarySettingsPanel } from '@/shared/map/boundary/BoundarySettingsPanel';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA, JIANGSU_SCENE_ZOOM_RANGE, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { CoordinateLocatePanel } from '@/shared/map/location/CoordinateLocatePanel';
import { LocationOverlay } from '@/shared/map/location/LocationOverlay';
import { useLocationPoint } from '@/shared/map/location/useLocationPoint';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MapPanelGroup, type PanelSlotProps } from '@/shared/map/panel-group/MapPanelGroup';
import { panelStackHeight } from '@/shared/map/panel-group/panel-stack';
import type { ListSplit } from '@/shared/map/layer-panel/panel-split';
import { usePanelGroup } from '@/shared/map/panel-group/usePanelGroup';
import { usePanelStack } from '@/shared/map/panel-group/usePanelStack';
import { useSideExclusion } from '@/shared/map/panel-group/useSideExclusion';
import { type MapOptionsContext, MapOptionsPopover } from '@/shared/map/popover/MapOptionsPopover';
import { MapPrintPanel } from '@/shared/map/print/MapPrintPanel';
import type { PrintLegendBlock } from '@/shared/map/print/print-legend';
import { DEFAULT_PRINT_SETTINGS, type PrintSettings, useMapPrint } from '@/shared/map/print/useMapPrint';
import { mergedActivity, type RequestSource } from '@/shared/map/request-status/request-status';
import { RequestStatusChip } from '@/shared/map/request-status/RequestStatusChip';
import { useRequestStatus } from '@/shared/map/request-status/useRequestStatus';
import { MapStatusBar } from '@/shared/map/status-bar/MapStatusBar';
import { useMapReadout } from '@/shared/map/status-bar/useMapReadout';
import { RegionLocatePanel } from '@/shared/map/region/RegionLocatePanel';
import { RegionScopeBar } from '@/shared/map/region/RegionScopeBar';
import { regionClipGroup } from '@/shared/map/region/region-clip';
import { readyBoundary, useRegionLocate } from '@/shared/map/region/useRegionLocate';
import { MapToolbar, type ToolbarButtonSlotProps } from '@/shared/map/toolbar/MapToolbar';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { useMapLoadMarks } from '@/shared/map/useMapLoadMarks';
import { useSwitchTo3dMarks } from '@/shared/map/useSwitchTo3dMarks';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import { usePreferenceScope } from '@/shared/storage/preference-scope';
import styles from './CurrentMapPage.module.scss';
import { CurrentMapLayerPanel } from './layer-panel/CurrentMapLayerPanel';
import { useCurrentLayers } from './layer-panel/useCurrentLayers';
import { requestKindsOf } from './layer-panel/layer-hints';
import { mapPageLayout } from './map-page-layout';

// 功能标签、独立详情和底图分开管理，功能与详情同列上下排列（ADR 0070）
const FUNCTION_PANELS = ['boundaries', 'legend', 'region-locate', 'coordinate-locate'] as const;
const PANEL_LABELS = {
  'region-locate': '区划定位',
  'coordinate-locate': '坐标定位',
  boundaries: '行政区边界',
  legend: '图例',
  basemap: '底图'
};

type FunctionPanel = (typeof FUNCTION_PANELS)[number];

// 地图操作、测量、定位、显示辅助、输出、清理分组；打印单独一组（ADR 0174）
const TOOLBAR_GROUPS = [
  ['browse', 'feature-pick'],
  ['measure-distance', 'measure-area'],
  ['region-locate', 'coordinate-locate'],
  ['boundaries', 'legend'],
  ['print'],
  ['clear']
] as const;

// 打印时不画的分组：测量、选中高亮这些临时的标记（用户 2026-11-24）；测量的读数、位置点本来就是页面元素，不在画布里。
// 选中要素的加强标注不在这里：它要换回普通标注，样式变了要重新排版，打印浮层开着时就撤掉
const PRINT_OMITTED_GROUPS = ['measure', 'selection'] as const;

const EMPTY_GROUP: StyleGroup = { sources: {}, layers: [] };

/** 现状底图：区域按 ADR 0053 划分，各块的界面在 5D.1～5D.8 逐块设计（docs/archive/roadmap.md"5D 地图页界面的专门设计"） */
export const CurrentMapPage = defineComponent({
  name: 'CurrentMapPage',
  setup() {
    // 注记压在资源图层上面，地名不被不透明的地类图斑盖住（2026-10-11 定，ADR 0033 第 4 条留到 5C 的问题）；
    // 选中要素的高亮在资源之上、注记之下（ADR 0047 第 5 节）；区划裁剪的遮罩盖住区划外的资源、高亮和底图的注记，边界在它上面
    // （ADR 0051，注记移到遮罩下面见 docs/design/current-map-reference.md）；区划高亮在边界之上，测量在最上面。
    // MapLibre 引擎的三维模型层在资源里：图层列表里排在最上面那个模型上面的资源画在模型上面，其余被模型挡住；高亮、资源的标注、
    // 区划遮罩及以上永远画在模型上面（ADR 0161，取代 ADR 0147 第 2 节的静态位置）。资源的标注在选中高亮之上、区划遮罩之下
    // （区划外的标注被盖住），查询详情里那个要素的加强标注紧挨着压在上面（ADR 0160）
    const map = provideMap({
      groups: [
        'basemap',
        'resources',
        'selection',
        'resource-labels',
        'selection-labels',
        'basemap-labels',
        'region-clip',
        'boundaries',
        'region',
        'measure'
      ],
      sceneBelow: 'selection',
      camera: JIANGSU_CAMERA
    });
    // 登录后第一次进入时记下加载的耗时（docs/modules/perf.md）
    useMapLoadMarks(map);
    useSwitchTo3dMarks(map);
    // 第一次就绪时按江苏的范围定位；基础组的"默认视角"、区划定位回到全省时回到这里
    const { goToDefaultView } = useDefaultView(map);
    // 业务组始终只显示图标，矮屏时分成两列；还量不到尺寸时按常规（ADR 0066）
    const root = ref<HTMLElement>();
    const { width, height } = useShownElementSize(root);
    const layout = computed(() => mapPageLayout(width.value, height.value, TOOLBAR_GROUPS));
    // 记住上次的底图、边界和资源图层（ADR 0042）；没有登录时为 null，不读不写；每一项是否生效看开关（ADR 0140）
    const preferences = usePreferenceScope();
    const basemap = useBasemap({ preferences });
    // 目录由查询加载和缓存，拥有者只管显示状态；还没有目录时重试，查询会回到 pending，不再是失败
    const catalogQuery = useResourceCatalogQuery();
    const symbols = useResourceSymbols({ catalog: catalogQuery.data, preferences });
    // 编辑时隐藏图例的全局恢复入口，保留当前图例和图层级操作
    const legendEditing = ref(false);
    // 图层面板的图例浮层正在样式设置的资源：右侧图例在设置同一个资源时回到图例（ADR 0157、0175）
    const legendCode = ref<string | null>(null);
    // 右侧图例正在样式设置的资源：图例浮层在设置同一个资源时回到看图例，不关浮层（ADR 0157、0175）
    const legendEditingCode = ref<string | null>(null);
    // 二维、三维各自一套已添加的资源（ADR 0169），部署时在 .env 里配
    const resources = useResourceLayers(map, {
      catalog: catalogQuery.data,
      preferences,
      symbols,
      perDimension: appConfig.layersPerDimension
    });
    const boundaries = useBoundaries({ preferences });
    const region = useRegionLocate(map, { goToDefaultView });
    const measure = useMeasure();
    const location = useLocationPoint(map);
    // 状态栏的比例尺、经纬度和角度（ADR 0053 第 5 节）
    const readout = useMapReadout(map);
    // 三维模型（ADR 0081）：资源目录里列出模型，二维里也能加入（ADR 0157），所以进页面就读清单
    const sceneModelsQuery = useSceneModelsQuery(true);
    // 模型贴地按部署（ADR 0170）
    const models = useSceneModels(map, sceneModelsQuery.data, { preferences, groundClamp: appConfig.sceneGroundClamp });
    // 图层里平铺的资源和模型（ADR 0161）：顺序就是叠放，面板显示和操作，地图按它放模型层
    const layerList = useCurrentLayers(resources, models, { preferences });
    // 图层行内提示显示哪几类（用户 2026-11-17，ADR 0167）：部署时在 .env 里配，同时管数据加载的条目和明细
    const hints = appConfig.layerHints;
    // 地图数据的请求状态（ADR 0158）：资源图层、三维里的模型、底图（几个数据源合成一项）；状态栏右边的条目和当前图层的
    // 行内转圈、失败用同一份，关掉的一类都不显示（ADR 0167）。接口请求不算，它们各自有加载状态
    const requests = useRequestStatus(
      () => {
        const activities = map.sourceActivity.value;
        const basemapActivity = mergedActivity(
          [...activities].flatMap(([sourceId, activity]) => (sourceId.startsWith('basemap') ? [activity] : []))
        );
        const sources: RequestSource[] = [
          ...resourceRequests(resources.state.value, activities),
          ...(map.dimension.value === '3d' ? modelRequests(models) : [])
        ];
        return basemapActivity
          ? [
              ...sources,
              { kind: 'tiles', key: 'basemap', name: '底图', icon: 'nav-current-map', activity: basemapActivity }
            ]
          : sources;
      },
      undefined,
      () => requestKindsOf(hints)
    );
    // 请求状态的明细里点了一行：在当前图层里选中它
    const revealed = shallowRef<{ readonly key: string } | null>(null);
    // 明细放在资源图层面板下方或右边、四周留白以内（用户 2026-11-16、2026-11-23）：量的是左列里的面板本身（按内容定高，
    // 收起后是竖条），不是撑满高度的一列；面板变高变矮按面板发出的两段高度重新放，不监听面板的尺寸（会报 ResizeObserver
    // loop）。交给条目的是同一组函数，重渲染时不换
    const overlay = ref<HTMLElement>();
    const left = ref<HTMLElement>();
    const leftPanel = () => {
      const panel = left.value?.firstElementChild;
      return panel instanceof HTMLElement ? panel : null;
    };
    const leftSplit = shallowRef<ListSplit | null>(null);
    const leftLayout = () => leftSplit.value;
    const mapArea = () => overlay.value ?? null;
    // 漫游中（地下空间只在漫游地下的模型时出现，ADR 0097）：只留漫游面板和小地图，工具栏、功能面板、底图、区划条、
    // 视图控件和状态栏都隐藏，不能加入模型、不能切回二维（ADR 0084、0095）；只隐藏不改状态，退出后原样显示
    const roaming = computed(() => models.roam.value !== null);
    // 小地图、完整地图的叫法按漫游的模型：站点叫站内地图，高斯泼溅叫平面图（ADR 0156）
    const roamPlace = computed(() => {
      const modelId = models.roam.value?.modelId;
      const model = models.models.value.find(item => item.id === modelId);
      return model ? roamPlaceOf(model) : null;
    });

    // 业务状态仍由各自的拥有者持有，这里只组合窗口与排布
    const functions = usePanelGroup(FUNCTION_PANELS);
    const basemapOpen = ref(false);
    // 地图打印的浮层（ADR 0174），和底图的浮层一样算右边打开着的
    const printOpen = ref(false);
    const detailOpen = ref(false);
    const lane = ref<HTMLElement>();
    const { height: laneHeight } = useShownElementSize(lane);
    const laneTop = ref(0);
    const basemapTop = ref<number | null>(null);
    const stackHeight = computed(() => panelStackHeight(laneHeight.value, laneTop.value, basemapTop.value));
    const stack = usePanelStack({
      height: () => stackHeight.value,
      functionsOpen: () => functions.state.value.open.length > 0,
      detailOpen: () => detailOpen.value
    });
    // 浮层报告定位结果，页面只量共同的列边界，留白由纯函数计算
    const changeBasemapTop = (top: number | null) => {
      laneTop.value = lane.value?.getBoundingClientRect().top ?? 0;
      basemapTop.value = top;
    };
    // 资源面板的收起、分割线的位置按账号记住，顺序随资源图层记住；窄屏时左右只显示一边，只推导显示，不改收起状态（ADR 0053 第 6、8 节）
    const panelLayout = useResourcePanelLayout({ preferences });
    // 二三维共用资源图层面板（ADR 0157）；漫游时左侧是漫游面板，它的收起不持久化，每次漫游从展开开始
    const roamCollapsed = ref(false);
    const leftCollapsed = computed(() => (roaming.value ? roamCollapsed.value : panelLayout.collapsed.value));
    const sides = useSideExclusion({
      leftExpanded: () => !leftCollapsed.value,
      rightOpen: () => functions.state.value.open.length > 0 || basemapOpen.value || printOpen.value || detailOpen.value
    });

    // 识别只打开独立详情，不切走正在查看的功能标签
    const pick = useFeaturePick(map, resources, {
      scope: () => readyBoundary(region.state.value)?.geometry ?? null,
      // 画在模型上面的资源点到模型时按鼠标下的地面识别（ADR 0161）
      overModels: code => layerList.overModels.value.includes(code),
      onIdentifyStart: () => {
        sides.activate('right');
        detailOpen.value = true;
        stack.activate('detail', true);
      }
    });
    // 取消勾选资源、切出点选工具等仍沿用拥有者的清理规则
    watch(
      () => pick.state.value.kind === 'idle',
      idle => {
        if (idle) {
          detailOpen.value = false;
        }
      }
    );

    map.registerTools(measure.tools);
    map.registerTools(location.tools);
    map.registerTools(pick.tools);
    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      resources: resources.deriveGroup,
      selection: pick.deriveGroup,
      // 加强标注的要素原来的标注滤掉，两组读同一份状态、同一轮提交（ADR 0160）；打印浮层开着时撤掉加强，
      // 这个要素显示普通标注，同没有选中时的地图（ADR 0174）
      'resource-labels': () => resources.deriveLabelsGroup(printOpen.value ? null : pick.labelEmphasis.value),
      'selection-labels': () => (printOpen.value ? EMPTY_GROUP : pick.deriveLabelsGroup()),
      // 选中市或区县、边界加载好后裁剪（ADR 0051 第 1 节）。遮罩一直画在模型上面，漫游时区划不适用、撤掉遮罩，
      // 不盖住漫游的画面；区划的选择不变，退出后原样回来（ADR 0161 第 7 节）
      'region-clip': () => regionClipGroup(roaming.value ? null : readyBoundary(region.state.value)),
      boundaries: boundaries.deriveGroup,
      region: region.deriveGroup,
      measure: measure.deriveGroup
    });
    map.bindScene(models.deriveContent);
    // 模型层插在画在模型上面的资源下面；没有时按 sceneBelow，在资源的最后（ADR 0161）
    map.bindSceneSlot(() => resources.sceneSlot(layerList.overModels.value));

    // 功能入口按显示状态开关；关闭定位面板不清掉区划和位置点
    // 按点击时右边是否显示决定：窄屏时让给了左边就是重新显示，不是关闭
    const toggleFunction = (id: FunctionPanel) => {
      const shown = sides.right.value && !stack.layout.value.collapsed.functions;
      sides.activate('right');
      functions.toggle(id, shown);
      stack.activate('functions', true);
    };
    // 底图的开关：入口、选了底图、点外部、Esc 都经过这里（ADR 0146）
    const changeBasemapOpen = (open: boolean) => {
      basemapOpen.value = open;
      if (open) {
        sides.activate('right');
      }
    };
    // 展开左侧面板算操作左边：窄屏时右边让出来
    const changeLeftCollapsed = (collapsed: boolean) => {
      if (roaming.value) {
        roamCollapsed.value = collapsed;
      } else {
        panelLayout.setCollapsed(collapsed);
      }
      if (!collapsed) {
        sides.activate('left');
      }
    };
    // 切换二三维：底图跟着换成这种视图默认的（ADR 0078 第 2 节）；切到二维结束漫游，漫游时页面上没有切换的入口（ADR 0097）
    const switchDimension = (kind: ViewKind) => {
      if (kind === '2d') {
        models.exitRoam();
      }
      map.setDimension(kind);
      basemap.selectForDimension(kind);
    };
    // 开始漫游时切回移动：测量、点选在漫游里不适用，退出后不恢复（ADR 0084、0097）；漫游面板展开
    watch(roaming, entered => {
      if (entered) {
        roamCollapsed.value = false;
        map.activateTool(BROWSE_TOOL);
      }
    });
    // 漫游接管鼠标，相当于一个工具：选了移动以外的工具就退出（ADR 0078 第 6 节）；开始漫游时切回移动不算
    watch(map.activeTool, tool => {
      if (tool !== BROWSE_TOOL) {
        models.exitRoam();
      }
    });
    // Esc 先关站内地图，再退出漫游（路线和步行）；空格开始、暂停或继续路线，焦点在输入框、按钮上时不拦截；页面停用期间不响应
    const pageActive = usePageActive();
    useEventListener(window, 'keydown', (event: KeyboardEvent) => {
      if (!pageActive.value || models.roam.value === null) {
        return;
      }
      if (event.key === 'Escape') {
        if (models.mapOpen.value) {
          models.closeMap();
        } else {
          models.exitRoam();
        }
        return;
      }
      const phase = models.routePhase.value;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // 完整地图打开着时路线暂停，空格不让它走（ADR 0097 第 6 节）
      if (
        phase !== null &&
        event.key === ' ' &&
        !models.mapOpen.value &&
        !target?.closest('input, textarea, button, [role="radio"]')
      ) {
        event.preventDefault();
        if (phase === 'playing') {
          models.pauseRoute();
        } else {
          models.playRoute();
        }
      }
    });
    // "清除"清掉地图上画的东西：测量结果和位置点；区划选择不算
    const clear = () => {
      measure.clear();
      location.remove();
    };

    // 地图打印（ADR 0174）：当前视角原样截图加图例导出 PNG，入口上的浮层同底图；图例只列画面里画出来的资源和取值，
    // 三维加上显示着的模型，最后是打开的行政区边界（用户 2026-11-24）
    const camera = map.useCamera();
    const printLegend = (view: MapViewport, size: { readonly width: number; readonly height: number }) => {
      const input = {
        state: resources.state.value,
        invalid: resources.configErrors.value,
        overrideOf: symbols.overrideOf,
        zoom: camera.value.zoom
      };
      // 三维里不显示资源图层时（能力 styleLayers 为 false，ADR 0080 第 5 节）没有资源
      const rendered = resources.hiddenInScene.value
        ? new Map()
        : renderedClasses({ ...input, view, size, scope: readyBoundary(region.state.value)?.geometry ?? null });
      const shownModels =
        map.dimension.value === '3d'
          ? printedModels(models.models.value, models.added.value, models.hidden.value, models.stateOf)
          : [];
      const boundaryState = { visible: boundaries.visible.value, opacity: boundaries.opacity.value };
      return [
        ...resourcePrintBlocks(printEntries(input, rendered)),
        modelPrintBlock(shownModels),
        boundaryPrintBlock(boundaryState)
      ].filter((block): block is PrintLegendBlock => block !== null);
    };
    const print = useMapPrint(map, { name: '现状底图', omitGroups: PRINT_OMITTED_GROUPS, legend: printLegend });
    // 设置在这次打开页面期间记住，不进偏好；标题默认是系统名（用户 2026-11-25）
    const printSettings = shallowRef<PrintSettings>({ ...DEFAULT_PRINT_SETTINGS, title: appConfig.title });
    const changePrintOpen = (open: boolean) => {
      printOpen.value = open;
      if (open) {
        sides.activate('right');
      }
    };
    // 漫游时工具栏隐藏，不提供打印（ADR 0174）：开着的浮层关掉，退出后不自己弹出来
    watch(roaming, entered => {
      if (entered) {
        printOpen.value = false;
      }
    });

    // 回调保持同一对象；按下状态只随面板的显示状态变化。打印的浮层由入口外面的 Popover 开关，这里只让右边显示出来
    const toolbarActions = {
      clear,
      'region-locate': () => toggleFunction('region-locate'),
      'coordinate-locate': () => toggleFunction('coordinate-locate'),
      boundaries: () => toggleFunction('boundaries'),
      legend: () => toggleFunction('legend'),
      print: () => sides.activate('right')
    };
    // 当前显示用浅底，后台标签只标主色；左右让出或收起后不显示为当前面板；打印的浮层开着时打印按下
    const pressed = computed(() => {
      const { current } = functions.state.value;
      const shown = sides.right.value && !stack.layout.value.collapsed.functions;
      const panels = shown && current !== null ? [current] : [];
      return printOpen.value && sides.right.value ? [...panels, 'print' as const] : panels;
    });

    // 当前底图的缩略图入口固定在地图控制栏下方
    const renderBasemapCard = () => (
      <div class={styles.cards} data-map-cards>
        <BasemapCard
          basemap={basemap}
          open={basemapOpen.value}
          visible={sides.right.value}
          onTopChange={changeBasemapTop}
          onUpdate:open={changeBasemapOpen}
        />
      </div>
    );

    // 左侧一个面板：三维漫游时是漫游面板，其余时候是二三维共用的资源图层面板（ADR 0157）。资源图层面板漫游时缓存起来，
    // 回来时搜索、展开、选中这些界面状态还在（停用期间按 ADR 0063 处理）；漫游面板不缓存，每次漫游重新开始
    const renderLeft = (scene: boolean) => {
      if (scene && roaming.value) {
        return (
          <RoamPanel models={models} collapsed={!sides.left.value} onUpdate:collapsed={changeLeftCollapsed} />
        );
      }
      const status = resources.state.value.catalog ? 'ready' : catalogQuery.isError.value ? 'failed' : 'loading';
      const modelsStatus = models.hasCatalog.value ? 'ready' : sceneModelsQuery.isError.value ? 'failed' : 'loading';
      return (
        <CurrentMapLayerPanel
          resources={resources}
          current={layerList}
          symbols={symbols}
          layout={panelLayout}
          models={models}
          requests={requests}
          hints={hints}
          reveal={revealed.value}
          legendYield={legendEditingCode.value}
          status={status}
          modelsStatus={modelsStatus}
          collapsed={!sides.left.value}
          sheet={layout.value.phone}
          onRetry={() => void catalogQuery.refetch()}
          onRetryModels={() => void sceneModelsQuery.refetch()}
          onUpdate:collapsed={changeLeftCollapsed}
          onLegendCode={(code: string | null) => (legendCode.value = code)}
          onLayout={(split: ListSplit | null) => (leftSplit.value = split)}
        />
      );
    };

    return () => {
      const { phone, toolbarColumns } = layout.value;
      const underground = roaming.value;
      // 手机宽度时资源面板展开，中间一列没有宽度，区划条不显示；漫游时区划不适用
      const scopeShown = (!phone || !sides.left.value) && !underground;
      const scene = map.dimension.value === '3d';
      // 引擎的能力 styleLayers 为 false 时三维里不显示资源图层，图例只有说明（ADR 0080 第 5 节）；app 注入的是 true（ADR 0157），只有测试走得到
      const resourcesHidden = resources.hiddenInScene.value;
      const indoorMap = models.indoorMap.value;
      const player = models.roamPlayer.value;
      const route = models.routeTrack.value;
      // 手机宽度时资源面板展开，小地图会压在面板上，同区划条一样先不显示（ADR 0087）
      const minimapShown = !phone || !sides.left.value;
      return (
        <div
          ref={root}
          class={[styles.root, phone && styles.phone]}
          style={{ '--map-tools-width': toolbarColumns ? '72px' : '40px' }}
          data-map-page={phone ? 'phone' : 'wide'}
        >
          <MapCanvas
            mapOptions={JIANGSU_MAP_OPTIONS}
            sceneMaxZoom={JIANGSU_SCENE_ZOOM_RANGE.maxZoom}
            scrollZoomRates={SCROLL_ZOOM_RATES}
          />
          <MeasureOverlay measure={measure}>{{ removeIcon: () => <SvgIcon name="close" size={12} /> }}</MeasureOverlay>
          <LocationOverlay location={location} />
          <BoxSelectOverlay pick={pick} />
          {/* 浮层里的区域都带 key：好几个按条件出现，同时变化时（开始漫游、进入地下空间、窄屏时换边）Vue 会把没有 key 的
              div 按类型配对，左侧面板的 KeepAlive 配到别的 div 上就被重建，搜索、展开这些状态丢失（2026-10-28 发现） */}
          <div ref={overlay} class={styles.overlay}>
            {/* 当前区划放在第一个：和面板重叠时（窄屏）面板在上面 */}
            {scopeShown && (
              <div key="scope" class={styles.scope}>
                <RegionScopeBar region={region} />
              </div>
            )}
            <div key="left" ref={left} class={[styles.left, underground && styles.noStatus]}>
              <KeepAlive exclude={RoamPanel.name}>{renderLeft(scene)}</KeepAlive>
            </div>
            <div key="lane" ref={lane} class={styles.lane}>
              <div
                class={styles.panelStack}
                style={{ height: laneHeight.value > 0 ? `${stackHeight.value}px` : '100%' }}
              >
                <MapPanelGroup
                  class={styles.functions}
                  style={{
                    maxHeight: stack.layout.value.functionsMaxHeight === undefined
                      ? undefined
                      : `${stack.layout.value.functionsMaxHeight}px`
                  }}
                  group={functions}
                  labels={PANEL_LABELS}
                  visible={sides.right.value && !underground}
                  collapsible
                  collapsed={stack.layout.value.collapsed.functions}
                  onActivate={() => stack.activate('functions')}
                  onUpdate:collapsed={value => stack.setCollapsed('functions', value)}
                >
                  {{
                    boundaries: ({ active }: PanelSlotProps) => [
                      <BoundarySettingsPanel boundaries={boundaries} active={active} />
                    ],
                    legend: ({ active }: PanelSlotProps) => [
                      <ResourceLegend
                        layers={resources}
                        symbols={symbols}
                        active={active}
                        scene={resourcesHidden}
                        yieldCode={legendCode.value}
                        onEditingChange={value => (legendEditing.value = value)}
                        onEditingCode={code => (legendEditingCode.value = code)}
                      />
                    ],
                    // 三维里不显示资源图层时图例只有说明，不显示全部恢复默认（ADR 0080 第 5 节）
                    'legend-footer': () =>
                      !legendEditing.value && !resourcesHidden && symbols.overrides.value.size > 0
                        ? [<ResourceLegendReset symbols={symbols} />]
                        : [],
                    'region-locate': () => [<RegionLocatePanel region={region} />],
                    'coordinate-locate': ({ active }: PanelSlotProps) => [
                      <CoordinateLocatePanel location={location} active={active} />
                    ]
                  }}
                </MapPanelGroup>
                {detailOpen.value && (
                  <FeatureDetailWindow
                    pick={pick}
                    visible={sides.right.value}
                    collapsed={stack.layout.value.collapsed.detail}
                    onActivate={() => stack.activate('detail')}
                    onUpdate:collapsed={value => stack.setCollapsed('detail', value)}
                    onClose={pick.close}
                  />
                )}
              </div>
            </div>
            {/* 漫游时的小地图在右上角：那里的工具栏、功能面板都隐藏了（ADR 0087、0097） */}
            {scene && indoorMap && player && minimapShown && (
              <div key="minimap" class={styles.minimap}>
                <IndoorMinimap
                  map={indoorMap}
                  player={player}
                  route={route}
                  title={roamPlace.value?.minimap}
                  onOpen={models.openMap}
                />
              </div>
            )}
            {/* 状态栏在左下角、左侧面板下面（ADR 0095）；请求状态是前面定宽的按钮，状态变了读数不动（ADR 0171） */}
            {!underground && (
              <div key="bottom" class={styles.bottom}>
                <MapStatusBar class={styles.status} readout={readout} format={location.state.value.format}>
                  {{
                    before: () => [
                      <RequestStatusChip
                        status={requests}
                        selectable={key => key !== 'basemap'}
                        panel={leftPanel}
                        panelCollapsed={!sides.left.value}
                        panelLayout={leftLayout}
                        area={mapArea}
                        onSelect={(key: string) => {
                          // 面板收起、窄屏时被右侧挤掉都看不到反应：先展开左侧，面板在下一轮渲染后滚到这一行、闪两下
                          changeLeftCollapsed(false);
                          revealed.value = { key };
                        }}
                        onRetry={(key: string) => {
                          const id = modelIdOfKey(key);
                          if (id !== null) {
                            models.retry(id);
                          }
                        }}
                      />
                    ]
                  }}
                </MapStatusBar>
              </div>
            )}
            <div key="tools" class={styles.tools}>
              {!underground && (
                <div key="business" class={styles.business}>
                  <MapToolbar
                    groups={TOOLBAR_GROUPS}
                    actions={toolbarActions}
                    pressed={pressed.value}
                    opened={functions.state.value.open}
                    compact
                    columns={toolbarColumns}
                  >
                    {{
                      print: ({ button }: ToolbarButtonSlotProps) => [
                        <MapOptionsPopover
                          name="print"
                          flush
                          open={printOpen.value}
                          visible={sides.right.value}
                          onUpdate:open={changePrintOpen}
                        >
                          {{
                            reference: () => [button],
                            default: ({ active, close, hold }: MapOptionsContext) => [
                              <MapPrintPanel
                                print={print}
                                settings={printSettings.value}
                                active={active}
                                dimension={map.dimension.value}
                                onUpdate:settings={(settings: PrintSettings) => (printSettings.value = settings)}
                                onDone={close}
                                onViewer={hold}
                              />
                            ]
                          }}
                        </MapOptionsPopover>
                      ]
                    }}
                  </MapToolbar>
                </div>
              )}
              {!underground && (
                <div key="stack" class={styles.stack}>
                  <div class={styles.controls}>
                    <MapViewControls
                      goToDefaultView={goToDefaultView}
                      zoomRange={scene ? JIANGSU_SCENE_ZOOM_RANGE : JIANGSU_ZOOM_RANGE}
                      dimension={map.dimension.value}
                      onUpdate:dimension={switchDimension}
                    />
                  </div>
                  {renderBasemapCard()}
                </div>
              )}
            </div>
          </div>
          {scene && indoorMap && player && models.mapOpen.value && (
            <IndoorMapDialog
              map={indoorMap}
              player={player}
              route={route}
              teleport={models.roam.value?.kind === 'walk'}
              title={roamPlace.value?.map}
              onTeleport={models.teleportWalk}
              onClose={models.closeMap}
            />
          )}
          <MapStatusNotice />
        </div>
      );
    };
  }
});
