import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent, ref } from 'vue';
import { FeatureDetailPanel } from '@/features/resource-map/components/FeatureDetailPanel';
import { ResourceLayerPanel } from '@/features/resource-map/components/ResourceLayerPanel';
import { ResourceLegend } from '@/features/resource-map/components/ResourceLegend';
import { useFeaturePick } from '@/features/resource-map/composables/useFeaturePick';
import { useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { useResourceCatalogQuery } from '@/features/resource-map/queries';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundaryPanel } from '@/shared/map/boundary/BoundaryPanel';
import { BoxSelectOverlay } from '@/shared/map/box-select/BoxSelectOverlay';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { CoordinateLocatePanel } from '@/shared/map/location/CoordinateLocatePanel';
import { LocationOverlay } from '@/shared/map/location/LocationOverlay';
import { useLocationPoint } from '@/shared/map/location/useLocationPoint';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MeasureOverlay } from '@/shared/map/measure/MeasureOverlay';
import { useMeasure } from '@/shared/map/measure/useMeasure';
import { RegionLocatePanel } from '@/shared/map/region/RegionLocatePanel';
import { regionClipGroup } from '@/shared/map/region/region-clip';
import { readyBoundary, useRegionLocate } from '@/shared/map/region/useRegionLocate';
import { MapToolbar } from '@/shared/map/toolbar/MapToolbar';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { usePreferenceScope } from '@/shared/storage/preference-scope';
import styles from './CurrentMapPage.module.scss';

/** 现状底图：联调用的骨架，界面在 5D 专门设计（docs/roadmap.md"阶段五"） */
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
    // 第一次就绪时按江苏的范围定位；工具栏的"默认视角"、区划定位回到全省时回到这里
    const { goToDefaultView } = useDefaultView(map);

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
    // 点选、框选只认区划里的要素，和遮罩用同一个边界（ADR 0051 第 1 节）
    const pick = useFeaturePick(map, resources, { scope: () => readyBoundary(region.state.value)?.geometry ?? null });
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

    // 面板开关只是界面状态，区划定位和坐标定位同一时间只开一个；关闭面板不清掉选择和位置点（ADR 0036、0037）
    type LocatePanel = 'region-locate' | 'coordinate-locate';
    const openPanel = ref<LocatePanel | null>(null);
    const togglePanel = (panel: LocatePanel) => (openPanel.value = openPanel.value === panel ? null : panel);
    const closePanel = () => (openPanel.value = null);
    // "清除"清掉地图上画的东西：测量结果和位置点；区划选择不算
    const clear = () => {
      measure.clear();
      location.remove();
    };

    return () => (
      <div class={styles.root}>
        <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} />
        <MeasureOverlay measure={measure} />
        <LocationOverlay location={location} />
        <BoxSelectOverlay box={pick.boxDraft.value} />
        <div class={styles.overlay}>
          <div class={styles.resources}>
            <ResourceLayerPanel
              layers={resources}
              failed={catalogQuery.isError.value}
              onRetry={() => void catalogQuery.refetch()}
            />
          </div>
          <div class={styles.controls}>
            <MapToolbar
              items={[
                'default-view',
                'browse',
                'feature-pick',
                'measure-distance',
                'measure-area',
                'clear',
                'region-locate',
                'coordinate-locate'
              ]}
              actions={{
                'default-view': goToDefaultView,
                clear,
                'region-locate': () => togglePanel('region-locate'),
                'coordinate-locate': () => togglePanel('coordinate-locate')
              }}
              pressed={openPanel.value ? [openPanel.value] : []}
            />
            {openPanel.value === 'region-locate' && <RegionLocatePanel region={region} onClose={closePanel} />}
            {openPanel.value === 'coordinate-locate' && (
              <CoordinateLocatePanel location={location} onClose={closePanel} />
            )}
            {pick.state.value.kind !== 'idle' && <FeatureDetailPanel pick={pick} />}
            <BasemapPanel basemap={basemap} />
            <BoundaryPanel boundaries={boundaries} />
            <div class={styles.legend}>
              <ResourceLegend layers={resources} symbols={symbols} />
            </div>
          </div>
        </div>
        <MapStatusNotice />
      </div>
    );
  }
});
