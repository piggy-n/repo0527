import type { ViewKind } from '@yzt/map-core';
import { type MapViewSwitchState, provideMap, SwitchableMapCanvas, type SwitchableMapCanvasHandle } from '@yzt/map-vue';
import { MxTitle } from '@yzt/ui';
import { computed, defineComponent, type PropType, ref, shallowRef, watch } from 'vue';
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
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { basemapOption } from '@/shared/map/basemap/basemap-style';
import { BasemapThumbnail } from '@/shared/map/basemap/BasemapThumbnail';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundaryPanel } from '@/shared/map/boundary/BoundaryPanel';
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
import { type PanelGroup, usePanelGroup } from '@/shared/map/panel-group/usePanelGroup';
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

// 右侧的两组 Tab 面板（ADR 0053 第 4 节）：功能面板和显示面板，Tab 按这里的顺序
const FUNCTION_PANELS = ['region-locate', 'coordinate-locate', 'feature-detail'] as const;
const DISPLAY_PANELS = ['legend', 'basemap'] as const;
const PANEL_LABELS = {
  'region-locate': '区划定位',
  'coordinate-locate': '坐标定位',
  'feature-detail': '资源详情',
  legend: '图例',
  basemap: '底图'
};

type LocatePanel = 'region-locate' | 'coordinate-locate';
type DisplayPanel = (typeof DISPLAY_PANELS)[number];

// 业务组的分组：移动、点选 · 测距、测面、清除 · 区划定位、坐标定位（ADR 0053 第 2 节）
const TOOLBAR_GROUPS = [
  ['browse', 'feature-pick'],
  ['measure-distance', 'measure-area', 'clear'],
  ['region-locate', 'coordinate-locate']
] as const;

/** 现状底图：区域按 ADR 0053 划分，各块的界面在 5D.1～5D.8 逐块设计（docs/roadmap.md"5D 地图页界面的专门设计"） */
export const CurrentMapPage = defineComponent({
  name: 'CurrentMapPage',
  props: {
    /** 运行时由应用装配提供，页面只选择目标视图 */
    assetBaseUrl: { type: String, required: true },
    prepareRuntime: { type: Function as PropType<(kind: ViewKind) => Promise<void>>, required: true }
  },
  setup(props) {
    const canvas = ref<SwitchableMapCanvasHandle>();
    const viewSwitch = shallowRef<MapViewSwitchState>({ current: null, target: '2d', status: 'loading' });
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
    // 手机宽度时卡片叠到工具栏一列，矮屏时业务组只显示图标（ADR 0053 第 8 节）；还量不到尺寸时按常规
    const root = ref<HTMLElement>();
    const { width, height } = useShownElementSize(root);
    const layout = computed(() => mapPageLayout(width.value, height.value));

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

    // 右侧的两组面板；已打开的功能和当前的 Tab 是页面的界面状态，业务状态在各自的拥有者里（ADR 0053 第 4 节）
    const functions = usePanelGroup(FUNCTION_PANELS);
    const display = usePanelGroup(DISPLAY_PANELS);
    // 资源面板的收起、分割线的位置和目录顺序按账号记住；窄屏时左右只显示一边，只推导显示，不改收起状态（ADR 0053 第 6、8 节）
    const panelLayout = useResourcePanelLayout({ preferences });
    const catalogOrder = useCatalogOrder({ preferences });
    const sides = useSideExclusion({
      leftExpanded: () => !panelLayout.collapsed.value,
      rightOpen: () => functions.state.value.open.length > 0 || display.state.value.open.length > 0
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

    // 右侧的入口：工具栏的区划定位、坐标定位，卡片行的图例、底图；关闭面板不清掉选择和位置点（ADR 0036、0037）。
    // 按点击时右边是否显示决定：窄屏时让给了左边就是重新显示，不是关闭
    const toggleFunction = (id: LocatePanel) => {
      const shown = sides.right.value;
      sides.activate('right');
      functions.toggle(id, shown);
    };
    const toggleDisplay = (id: DisplayPanel) => {
      const shown = sides.right.value;
      sides.activate('right');
      display.toggle(id, shown);
    };
    // 入口显示为按下：打开着，而且右边没有让出去
    const pressedIn = (group: PanelGroup, id: string) => sides.right.value && group.isOpen(id);
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
      'coordinate-locate': () => toggleFunction('coordinate-locate')
    };
    const pressed = computed(() =>
      (['region-locate', 'coordinate-locate'] as const).filter(id => pressedIn(functions, id))
    );

    // 卡片行：图例卡、底图卡（当前底图的缩略图和简称，ADR 0057），点开显示面板里对应的 Tab；手机宽度时叠在基础组上面
    const renderCards = () => {
      const current = basemapOption(basemap.selected.value);
      return (
        <div class={styles.cards} data-map-cards>
          <MapCard
            label={PANEL_LABELS.legend}
            pressed={pressedIn(display, 'legend')}
            onClick={() => toggleDisplay('legend')}>
            {{ icon: () => [<SvgIcon name="map-legend" size={20} />] }}
          </MapCard>
          <MapCard
            label={current.shortLabel}
            name={`${PANEL_LABELS.basemap}：${current.label}`}
            pressed={pressedIn(display, 'basemap')}
            onClick={() => toggleDisplay('basemap')}>
            {{ cover: () => [<BasemapThumbnail thumbnail={basemap.thumbnails[current.id]} />] }}
          </MapCard>
        </div>
      );
    };

    return () => {
      const { phone, compactToolbar } = layout.value;
      // 手机宽度时资源面板展开，中间一列没有宽度，区划条不显示
      const scopeShown = !phone || !sides.left.value;
      return (
        <div ref={root} class={[styles.root, phone && styles.phone]} data-map-page={phone ? 'phone' : 'wide'}>
          <SwitchableMapCanvas
            ref={canvas}
            assetBaseUrl={props.assetBaseUrl}
            prepareRuntime={props.prepareRuntime}
            mapOptions={JIANGSU_ZOOM_RANGE}
            scrollZoomRates={SCROLL_ZOOM_RATES}
            onState={value => { viewSwitch.value = value; }}
          />
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
                  'region-locate': () => [<RegionLocatePanel region={region} />],
                  'coordinate-locate': ({ active }: PanelSlotProps) => [
                    <CoordinateLocatePanel location={location} active={active} />
                  ],
                  'feature-detail': () => [<FeatureDetailPanel pick={pick} />]
                }}
              </MapPanelGroup>
              <div class={styles.spacer} />
              <MapPanelGroup group={display} labels={PANEL_LABELS} visible={sides.right.value}>
                {{
                  legend: ({ active }: PanelSlotProps) => [
                    <ResourceLegend layers={resources} symbols={symbols} active={active} />
                  ],
                  basemap: () => [
                    <BasemapPanel basemap={basemap} />,
                    <MxTitle level="section">行政区</MxTitle>,
                    <BoundaryPanel boundaries={boundaries} />
                  ]
                }}
              </MapPanelGroup>
            </div>
            <div class={styles.bottom}>
              <MapStatusBar class={styles.status} readout={readout} format={location.state.value.format} />
              {!phone && renderCards()}
            </div>
            <div class={styles.tools}>
              <MapToolbar
                groups={TOOLBAR_GROUPS}
                actions={toolbarActions}
                pressed={pressed.value}
                compact={compactToolbar}
              />
              <div class={styles.stack}>
                {phone && renderCards()}
                <MapViewControls
                  goToDefaultView={goToDefaultView}
                  zoomRange={JIANGSU_ZOOM_RANGE}
                  viewSwitch={viewSwitch.value}
                  onSwitch={kind => { void canvas.value?.switchTo(kind); }}
                />
              </div>
            </div>
          </div>
          <MapStatusNotice viewSwitch={viewSwitch.value} onRetrySwitch={() => { void canvas.value?.retry(); }} />
        </div>
      );
    };
  }
});
