import type { ViewKind } from '@yzt/map-core';
import { CesiumCanvas, MapCanvas, provideMap, type UnsupportedLayer } from '@yzt/map-vue';
import { computed, defineComponent, KeepAlive, ref, watch } from 'vue';
import { FeatureDetailWindow } from '@/features/resource-map/components/FeatureDetailWindow';
import { ResourceLayerPanel } from '@/features/resource-map/components/ResourceLayerPanel';
import { ResourceLegend } from '@/features/resource-map/components/ResourceLegend';
import { ResourceLegendReset } from '@/features/resource-map/components/ResourceLegendReset';
import { useCatalogOrder } from '@/features/resource-map/composables/useCatalogOrder';
import { useFeaturePick } from '@/features/resource-map/composables/useFeaturePick';
import { useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { useResourceCatalogQuery } from '@/features/resource-map/queries';
import { SceneModelPanel } from '@/features/scene-models/components/SceneModelPanel';
import { UndergroundBar } from '@/features/scene-models/components/UndergroundBar';
import { useSceneModels } from '@/features/scene-models/composables/useSceneModels';
import { useSceneModelsQuery } from '@/features/scene-models/queries';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { basemapOption } from '@/shared/map/basemap/basemap-style';
import { BasemapThumbnail } from '@/shared/map/basemap/BasemapThumbnail';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundarySettingsPanel } from '@/shared/map/boundary/BoundarySettingsPanel';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { BoxSelectOverlay } from '@/shared/map/box-select/BoxSelectOverlay';
import { MapCard } from '@/shared/map/card/MapCard';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { CoordinateLocatePanel } from '@/shared/map/location/CoordinateLocatePanel';
import { LocationOverlay } from '@/shared/map/location/LocationOverlay';
import { useLocationPoint } from '@/shared/map/location/useLocationPoint';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MeasureOverlay } from '@/shared/map/measure/MeasureOverlay';
import { useMeasure } from '@/shared/map/measure/useMeasure';
import { MapPanelGroup, type PanelSlotProps } from '@/shared/map/panel-group/MapPanelGroup';
import { panelStackHeight } from '@/shared/map/panel-group/panel-stack';
import { usePanelGroup } from '@/shared/map/panel-group/usePanelGroup';
import { usePanelStack } from '@/shared/map/panel-group/usePanelStack';
import { useSideExclusion } from '@/shared/map/panel-group/useSideExclusion';
import { MapOptionsPopover } from '@/shared/map/popover/MapOptionsPopover';
import { MapStatusBar } from '@/shared/map/status-bar/MapStatusBar';
import { useMapReadout } from '@/shared/map/status-bar/useMapReadout';
import { RegionLocatePanel } from '@/shared/map/region/RegionLocatePanel';
import { RegionScopeBar } from '@/shared/map/region/RegionScopeBar';
import { regionClipGroup } from '@/shared/map/region/region-clip';
import { readyBoundary, useRegionLocate } from '@/shared/map/region/useRegionLocate';
import { MapToolbar } from '@/shared/map/toolbar/MapToolbar';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { useMapLoadMarks } from '@/shared/map/useMapLoadMarks';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import { usePreferenceScope } from '@/shared/storage/preference-scope';
import styles from './CurrentMapPage.module.scss';
import { mapPageLayout } from './map-page-layout';

// 功能标签、独立详情和底图分开管理，功能与详情同列上下排列（ADR 0070）
const FUNCTION_PANELS = ['boundaries', 'legend', 'region-locate', 'coordinate-locate'] as const;
const PANEL_LABELS = {
  'region-locate': '区划定位',
  'coordinate-locate': '坐标定位',
  boundaries: '行政区',
  legend: '图例',
  basemap: '底图'
};

type FunctionPanel = (typeof FUNCTION_PANELS)[number];

// 三维跳过的图层（ADR 0079 第 7 节）：开发环境下每个图层提示一次，生产环境不提示
const reportUnsupported = import.meta.env.DEV
  ? ({ layerId, reason }: UnsupportedLayer) => console.warn(`[三维] 跳过图层 ${layerId}：${reason}`)
  : undefined;

// 地图操作、测量、定位、显示辅助、清理分组
const TOOLBAR_GROUPS = [
  ['browse', 'feature-pick'],
  ['measure-distance', 'measure-area'],
  ['region-locate', 'coordinate-locate'],
  ['boundaries', 'legend'],
  ['clear']
] as const;

/** 现状底图：区域按 ADR 0053 划分，各块的界面在 5D.1～5D.8 逐块设计（docs/roadmap.md"5D 地图页界面的专门设计"） */
export const CurrentMapPage = defineComponent({
  name: 'CurrentMapPage',
  setup() {
    // 注记压在资源图层上面，地名不被不透明的地类图斑盖住（2026-10-11 定，ADR 0033 第 4 条留到 5C 的问题）；
    // 选中要素的高亮在资源之上、注记之下（ADR 0047 第 5 节）；区划裁剪的遮罩盖住区划外的资源和高亮，注记、边界在它上面
    // （ADR 0051）；边界压在注记上面，区划高亮在边界之上，测量在最上面
    const map = provideMap({
      groups: ['basemap', 'resources', 'selection', 'region-clip', 'basemap-labels', 'boundaries', 'region', 'measure'],
      camera: JIANGSU_CAMERA
    });
    // 登录后第一次进入时记下加载的耗时（docs/modules/perf.md）
    useMapLoadMarks(map);
    // 第一次就绪时按江苏的范围定位；基础组的"默认视角"、区划定位回到全省时回到这里
    const { goToDefaultView } = useDefaultView(map);
    // 业务组始终只显示图标，矮屏时分成两列；还量不到尺寸时按常规（ADR 0066）
    const root = ref<HTMLElement>();
    const { width, height } = useShownElementSize(root);
    const layout = computed(() => mapPageLayout(width.value, height.value));
    // 记住上次的底图、边界和资源图层（ADR 0042）；没有登录时为 null，不读不写
    const preferences = usePreferenceScope();
    const basemap = useBasemap({ preferences });
    // 目录由查询加载和缓存，拥有者只管显示状态；还没有目录时重试，查询会回到 pending，不再是失败
    const catalogQuery = useResourceCatalogQuery();
    const symbols = useResourceSymbols({ catalog: catalogQuery.data, preferences });
    // 编辑时隐藏图例的全局恢复入口，保留当前图例和图层级操作
    const legendEditing = ref(false);
    const resources = useResourceLayers(map, { catalog: catalogQuery.data, preferences, symbols });
    const boundaries = useBoundaries({ preferences });
    const region = useRegionLocate(map, { goToDefaultView });
    const measure = useMeasure();
    const location = useLocationPoint(map);
    // 状态栏的比例尺、经纬度和角度（ADR 0053 第 5 节）
    const readout = useMapReadout(map);
    // 三维模型（ADR 0081）：第一次切到三维时才读清单
    const sceneModelsQuery = useSceneModelsQuery(() => map.dimension.value === '3d');
    const models = useSceneModels(map, sceneModelsQuery.data);

    // 业务状态仍由各自的拥有者持有，这里只组合窗口与排布
    const functions = usePanelGroup(FUNCTION_PANELS);
    const basemapOpen = ref(false);
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
    // 资源面板的收起、分割线的位置和目录顺序按账号记住；窄屏时左右只显示一边，只推导显示，不改收起状态（ADR 0053 第 6、8 节）
    const panelLayout = useResourcePanelLayout({ preferences });
    const catalogOrder = useCatalogOrder({ preferences });
    // 三维时左侧是三维模型面板，两个面板的收起各自保留（ADR 0081 第 7 节）；模型面板的不持久化
    const modelsCollapsed = ref(false);
    const leftCollapsed = computed(() =>
      map.dimension.value === '3d' ? modelsCollapsed.value : panelLayout.collapsed.value
    );
    const sides = useSideExclusion({
      leftExpanded: () => !leftCollapsed.value,
      rightOpen: () => functions.state.value.open.length > 0 || basemapOpen.value || detailOpen.value
    });

    // 识别只打开独立详情，不切走正在查看的功能标签
    const pick = useFeaturePick(map, resources, {
      scope: () => readyBoundary(region.state.value)?.geometry ?? null,
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
      // 选中市或区县、边界加载好后裁剪（ADR 0051 第 1 节）
      'region-clip': () => regionClipGroup(readyBoundary(region.state.value)),
      boundaries: boundaries.deriveGroup,
      region: region.deriveGroup,
      measure: measure.deriveGroup
    });
    map.bindScene(models.deriveContent);

    // 功能入口按显示状态开关；关闭定位面板不清掉区划和位置点
    // 按点击时右边是否显示决定：窄屏时让给了左边就是重新显示，不是关闭
    const toggleFunction = (id: FunctionPanel) => {
      const shown = sides.right.value && !stack.layout.value.collapsed.functions;
      sides.activate('right');
      functions.toggle(id, shown);
      stack.activate('functions', true);
    };
    // 底图入口切换开关，外部点击不关闭
    const changeBasemapOpen = (open: boolean) => {
      basemapOpen.value = open;
      if (open) {
        sides.activate('right');
      }
    };
    // 展开左侧面板算操作左边：窄屏时右边让出来
    const changeLeftCollapsed = (collapsed: boolean) => {
      if (map.dimension.value === '3d') {
        modelsCollapsed.value = collapsed;
      } else {
        panelLayout.setCollapsed(collapsed);
      }
      if (!collapsed) {
        sides.activate('left');
      }
    };
    // 切换二三维：底图跟着换成这种视图默认的（ADR 0078 第 2 节）；切到二维结束钻地（ADR 0081 第 6 节）
    const switchDimension = (kind: ViewKind) => {
      if (kind === '2d') {
        models.exitUnderground();
      }
      map.setDimension(kind);
      basemap.selectForDimension(kind);
    };
    // "清除"清掉地图上画的东西：测量结果和位置点；区划选择不算
    const clear = () => {
      measure.clear();
      location.remove();
    };
    // 回调保持同一对象；按下状态只随面板的显示状态变化
    const toolbarActions = {
      clear,
      'region-locate': () => toggleFunction('region-locate'),
      'coordinate-locate': () => toggleFunction('coordinate-locate'),
      boundaries: () => toggleFunction('boundaries'),
      legend: () => toggleFunction('legend')
    };
    // 当前显示用浅底，后台标签只标主色；左右让出或收起后不显示为当前面板
    const pressed = computed(() => {
      const { current } = functions.state.value;
      const shown = sides.right.value && !stack.layout.value.collapsed.functions;
      return shown && current !== null ? [current] : [];
    });

    // 当前底图的缩略图入口固定在地图控制栏下方
    const renderBasemapCard = () => {
      const current = basemapOption(basemap.selected.value);
      return (
        <div class={styles.cards} data-map-cards>
          <MapOptionsPopover
            name="basemap"
            label="底图"
            opacity={basemap.opacity.value}
            open={basemapOpen.value}
            visible={sides.right.value}
            onTopChange={changeBasemapTop}
            onOpacityChange={basemap.setOpacity}
            onUpdate:open={changeBasemapOpen}
          >
            {{
              reference: () => [
                <MapCard
                  label={current.shortLabel}
                  name={`${PANEL_LABELS.basemap}：${current.label}`}
                  pressed={sides.right.value && basemapOpen.value}
                >
                  {{ cover: () => [<BasemapThumbnail thumbnail={basemap.thumbnails[current.id]} />] }}
                </MapCard>
              ],
              default: () => [
                <BasemapPanel basemap={basemap} showOpacity={false} />
              ]
            }}
          </MapOptionsPopover>
        </div>
      );
    };

    return () => {
      const { phone, toolbarColumns } = layout.value;
      // 手机宽度时资源面板展开，中间一列没有宽度，区划条不显示
      const scopeShown = !phone || !sides.left.value;
      const scene = map.dimension.value === '3d';
      return (
        <div
          ref={root}
          class={[styles.root, phone && styles.phone]}
          style={{ '--map-tools-width': toolbarColumns ? '72px' : '40px' }}
          data-map-page={phone ? 'phone' : 'wide'}
        >
          <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} scrollZoomRates={SCROLL_ZOOM_RATES} />
          <CesiumCanvas onUnsupported={reportUnsupported} />
          <MeasureOverlay measure={measure} />
          <LocationOverlay location={location} />
          <BoxSelectOverlay pick={pick} />
          <div class={styles.overlay}>
            {/* 当前区划放在第一个：和面板重叠时（窄屏）面板在上面 */}
            {scopeShown && (
              <div class={styles.scope}>
                <RegionScopeBar region={region} />
              </div>
            )}
            <div class={styles.left}>
              {/* 二三维各一个面板：切走的缓存起来，回来时搜索、展开这些界面状态还在（停用期间按 ADR 0063 处理） */}
              <KeepAlive>
                {scene ? (
                  <SceneModelPanel
                    models={models}
                    failed={sceneModelsQuery.isError.value}
                    collapsed={!sides.left.value}
                    onRetry={() => void sceneModelsQuery.refetch()}
                    onUpdate:collapsed={changeLeftCollapsed}
                  />
                ) : (
                  <ResourceLayerPanel
                    layers={resources}
                    catalogOrder={catalogOrder}
                    layout={panelLayout}
                    failed={catalogQuery.isError.value}
                    collapsed={!sides.left.value}
                    onRetry={() => void catalogQuery.refetch()}
                    onUpdate:collapsed={changeLeftCollapsed}
                  />
                )}
              </KeepAlive>
            </div>
            <div ref={lane} class={styles.lane}>
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
                  visible={sides.right.value}
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
                        scene={map.dimension.value === '3d'}
                        onEditingChange={value => (legendEditing.value = value)}
                      />
                    ],
                    // 三维时图例只有说明，不显示全部恢复默认（ADR 0080 第 5 节）
                    'legend-footer': () =>
                      !legendEditing.value && map.dimension.value === '2d' && symbols.overrides.value.size > 0
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
            {scene && (
              <div class={[styles.underground, phone && styles.phoneUnderground]}>
                <UndergroundBar models={models} />
              </div>
            )}
            <div class={styles.bottom}>
              <MapStatusBar class={styles.status} readout={readout} format={location.state.value.format} />
            </div>
            <div class={styles.tools}>
              <div class={styles.business}>
                <MapToolbar
                  groups={TOOLBAR_GROUPS}
                  actions={toolbarActions}
                  pressed={pressed.value}
                  opened={functions.state.value.open}
                  compact
                  columns={toolbarColumns}
                />
              </div>
              <div class={styles.stack}>
                <div class={styles.controls}>
                  <MapViewControls
                    goToDefaultView={goToDefaultView}
                    zoomRange={JIANGSU_ZOOM_RANGE}
                    dimension={map.dimension.value}
                    onUpdate:dimension={switchDimension}
                  />
                </div>
                {renderBasemapCard()}
              </div>
            </div>
          </div>
          <MapStatusNotice />
        </div>
      );
    };
  }
});
