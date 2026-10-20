import { MapCanvas, provideMap } from '@yzt/map-vue';
import { computed, defineComponent, ref, watch } from 'vue';
import { FeatureDetailPanel } from '@/features/resource-map/components/FeatureDetailPanel';
import { ResourceLayerPanel } from '@/features/resource-map/components/ResourceLayerPanel';
import { ResourceLegend } from '@/features/resource-map/components/ResourceLegend';
import { useCatalogOrder } from '@/features/resource-map/composables/useCatalogOrder';
import { useFeaturePick } from '@/features/resource-map/composables/useFeaturePick';
import { useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { useResourceCatalogQuery } from '@/features/resource-map/queries';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { BasemapWindow } from '@/shared/map/basemap/BasemapWindow';
import { basemapOption } from '@/shared/map/basemap/basemap-style';
import { BasemapThumbnail } from '@/shared/map/basemap/BasemapThumbnail';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoxSelectOverlay } from '@/shared/map/box-select/BoxSelectOverlay';
import { MapCard } from '@/shared/map/card/MapCard';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { CoordinateLocatePanel } from '@/shared/map/location/CoordinateLocatePanel';
import { LocationOverlay } from '@/shared/map/location/LocationOverlay';
import { useLocationPoint } from '@/shared/map/location/useLocationPoint';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MeasureOverlay } from '@/shared/map/measure/MeasureOverlay';
import { useMeasure } from '@/shared/map/measure/useMeasure';
import { MapPanelGroup, type PanelSlotProps } from '@/shared/map/panel-group/MapPanelGroup';
import { usePanelGroup } from '@/shared/map/panel-group/usePanelGroup';
import { MapStatusBar } from '@/shared/map/status-bar/MapStatusBar';
import { useMapReadout } from '@/shared/map/status-bar/useMapReadout';
import { useSideExclusion } from '@/shared/map/panel-group/useSideExclusion';
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

// 图例与定位、资源详情共用功能面板；底图是独立浮窗（ADR 0066）
const FUNCTION_PANELS = ['legend', 'region-locate', 'coordinate-locate', 'feature-detail'] as const;
const PANEL_LABELS = {
  'region-locate': '区划定位',
  'coordinate-locate': '坐标定位',
  'feature-detail': '资源详情',
  legend: '图例',
  basemap: '底图'
};

type FunctionPanel = Exclude<(typeof FUNCTION_PANELS)[number], 'feature-detail'>;

// 业务组沿用原有分组，图例固定在最下方（ADR 0066）
const TOOLBAR_GROUPS = [
  ['browse', 'feature-pick'],
  ['measure-distance', 'measure-area', 'clear'],
  ['region-locate', 'coordinate-locate'],
  ['legend']
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
    // 底图浮窗与基础控制条等高，直接量控制条，不重复维护按钮高度
    const controls = ref<HTMLElement>();
    const { height: controlsHeight } = useShownElementSize(controls, undefined, { box: 'border-box' });

    // 记住上次的底图、边界和资源图层（ADR 0042）；没有登录时为 null，不读不写
    const preferences = usePreferenceScope();
    const basemap = useBasemap({ preferences });
    // 目录由查询加载和缓存，拥有者只管显示状态；还没有目录时重试，查询会回到 pending，不再是失败
    const catalogQuery = useResourceCatalogQuery();
    const symbols = useResourceSymbols({ catalog: catalogQuery.data, preferences });
    const resources = useResourceLayers(map, { catalog: catalogQuery.data, preferences, symbols });
    const boundaries = useBoundaries({ preferences });
    const region = useRegionLocate(map, { goToDefaultView });
    const measure = useMeasure();
    const location = useLocationPoint(map);
    // 状态栏的比例尺、经纬度和角度（ADR 0053 第 5 节）
    const readout = useMapReadout(map);

    // 功能面板和底图分别开关，业务状态仍由各自的拥有者持有
    const functions = usePanelGroup(FUNCTION_PANELS);
    const basemapOpen = ref(false);
    // 资源面板的收起、分割线的位置和目录顺序按账号记住；窄屏时左右只显示一边，只推导显示，不改收起状态（ADR 0053 第 6、8 节）
    const panelLayout = useResourcePanelLayout({ preferences });
    const catalogOrder = useCatalogOrder({ preferences });
    const sides = useSideExclusion({
      leftExpanded: () => !panelLayout.collapsed.value,
      rightOpen: () => functions.state.value.open.length > 0 || basemapOpen.value
    });

    // 点选、框选只认区划里的要素，和遮罩用同一个边界（ADR 0051 第 1 节）；用户开始识别时切到资源详情
    const pick = useFeaturePick(map, resources, {
      scope: () => readyBoundary(region.state.value)?.geometry ?? null,
      onIdentifyStart: () => {
        sides.activate('right');
        functions.show('feature-detail');
      }
    });
    // 拥有者清除了结果（关闭、取消勾选资源、离开点选工具等）时资源详情随之关闭；请求返回时不切换 Tab
    watch(
      () => pick.state.value.kind === 'idle',
      idle => {
        if (idle) {
          functions.close('feature-detail');
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

    // 功能入口按显示状态开关；关闭定位面板不清掉区划和位置点
    // 按点击时右边是否显示决定：窄屏时让给了左边就是重新显示，不是关闭
    const toggleFunction = (id: FunctionPanel) => {
      const shown = sides.right.value;
      sides.activate('right');
      functions.toggle(id, shown);
    };
    const toggleBasemap = () => {
      const shown = sides.right.value;
      sides.activate('right');
      basemapOpen.value = !shown || !basemapOpen.value;
    };
    // 入口显示为按下：打开着，而且右边没有让出去
    const pressedIn = (id: FunctionPanel) => sides.right.value && functions.isOpen(id);
    // 关闭资源详情就是清除选择（ADR 0053 第 4 节）；外壳已经从组里关掉了它
    const closeFunction = (id: string) => {
      if (id === 'feature-detail') {
        pick.close();
      }
    };
    // 展开资源面板算操作左边：窄屏时右边让出来
    const changeResourcesCollapsed = (collapsed: boolean) => {
      panelLayout.setCollapsed(collapsed);
      if (!collapsed) {
        sides.activate('left');
      }
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
      legend: () => toggleFunction('legend')
    };
    const pressed = computed(() => (['region-locate', 'coordinate-locate', 'legend'] as const).filter(pressedIn));

    // 当前底图的缩略图入口固定在地图控制栏下方
    const renderBasemapCard = () => {
      const current = basemapOption(basemap.selected.value);
      return (
        <div class={styles.cards} data-map-cards>
          <MapCard
            label={current.shortLabel}
            name={`${PANEL_LABELS.basemap}：${current.label}`}
            pressed={sides.right.value && basemapOpen.value}
            onClick={toggleBasemap}>
            {{ cover: () => [<BasemapThumbnail thumbnail={basemap.thumbnails[current.id]} />] }}
          </MapCard>
        </div>
      );
    };

    return () => {
      const { phone, toolbarColumns } = layout.value;
      // 手机宽度时资源面板展开，中间一列没有宽度，区划条不显示
      const scopeShown = !phone || !sides.left.value;
      return (
        <div
          ref={root}
          class={[styles.root, phone && styles.phone]}
          style={{
            '--map-tools-width': toolbarColumns ? '72px' : '40px',
            '--map-controls-height': controlsHeight.value > 0 ? `${controlsHeight.value}px` : undefined
          }}
          data-map-page={phone ? 'phone' : 'wide'}>
          <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} scrollZoomRates={SCROLL_ZOOM_RATES} />
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
              <ResourceLayerPanel
                layers={resources}
                catalogOrder={catalogOrder}
                layout={panelLayout}
                failed={catalogQuery.isError.value}
                collapsed={!sides.left.value}
                onRetry={() => void catalogQuery.refetch()}
                onUpdate:collapsed={changeResourcesCollapsed}
              />
            </div>
            <div class={styles.lane}>
              <MapPanelGroup group={functions} labels={PANEL_LABELS} visible={sides.right.value} onClose={closeFunction}>
                {{
                  legend: ({ active }: PanelSlotProps) => [
                    <ResourceLegend layers={resources} symbols={symbols} active={active} />
                  ],
                  'region-locate': () => [<RegionLocatePanel region={region} />],
                  'coordinate-locate': ({ active }: PanelSlotProps) => [
                    <CoordinateLocatePanel location={location} active={active} />
                  ],
                  'feature-detail': () => [<FeatureDetailPanel pick={pick} />]
                }}
              </MapPanelGroup>
            </div>
            <BasemapWindow
              class={styles.basemapWindow}
              basemap={basemap}
              boundaries={boundaries}
              open={basemapOpen.value}
              visible={sides.right.value}
              onClose={() => (basemapOpen.value = false)}
            />
            <div class={styles.bottom}>
              <MapStatusBar class={styles.status} readout={readout} format={location.state.value.format} />
            </div>
            <div class={styles.tools}>
              <div class={styles.business}>
                <MapToolbar
                  groups={TOOLBAR_GROUPS}
                  actions={toolbarActions}
                  pressed={pressed.value}
                  compact
                  columns={toolbarColumns}
                />
              </div>
              <div class={styles.stack}>
                <div ref={controls} class={styles.controls}>
                  <MapViewControls goToDefaultView={goToDefaultView} zoomRange={JIANGSU_ZOOM_RANGE} />
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
