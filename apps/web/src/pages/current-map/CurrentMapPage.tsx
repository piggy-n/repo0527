import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent, ref } from 'vue';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundaryPanel } from '@/shared/map/boundary/BoundaryPanel';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { CoordinateLocatePanel } from '@/shared/map/location/CoordinateLocatePanel';
import { LocationOverlay } from '@/shared/map/location/LocationOverlay';
import { useLocationPoint } from '@/shared/map/location/useLocationPoint';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MeasureOverlay } from '@/shared/map/measure/MeasureOverlay';
import { useMeasure } from '@/shared/map/measure/useMeasure';
import { RegionLocatePanel } from '@/shared/map/region/RegionLocatePanel';
import { useRegionLocate } from '@/shared/map/region/useRegionLocate';
import { MapToolbar } from '@/shared/map/toolbar/MapToolbar';
import { useDefaultView } from '@/shared/map/useDefaultView';
import styles from './CurrentMapPage.module.scss';

/** 现状底图：联调用的骨架，界面在 5D 专门设计（docs/roadmap.md"阶段五"） */
export const CurrentMapPage = defineComponent({
  name: 'CurrentMapPage',
  setup() {
    // 边界压在注记上面，以后资源图层放在两者之间（ADR 0033 第 4 条）；区划高亮在边界之上，测量在最上面
    const map = provideMap({
      groups: ['basemap', 'basemap-labels', 'boundaries', 'region', 'measure'],
      camera: JIANGSU_CAMERA
    });
    // 第一次就绪时按江苏的范围定位；工具栏的"默认视角"、区划定位回到全省时回到这里
    const { goToDefaultView } = useDefaultView(map);

    const basemap = useBasemap();
    const boundaries = useBoundaries();
    const region = useRegionLocate(map, { goToDefaultView });
    const measure = useMeasure();
    const location = useLocationPoint(map);
    map.registerTools(measure.tools);
    map.registerTools(location.tools);
    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
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
        <div class={styles.controls}>
          <MapToolbar
            items={[
              'default-view',
              'browse',
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
          <BasemapPanel basemap={basemap} />
          <BoundaryPanel boundaries={boundaries} />
        </div>
        <MapStatusNotice />
      </div>
    );
  }
});
