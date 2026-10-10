import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent, ref } from 'vue';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundaryPanel } from '@/shared/map/boundary/BoundaryPanel';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
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
    map.registerTools(measure.tools);
    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      boundaries: boundaries.deriveGroup,
      region: region.deriveGroup,
      measure: measure.deriveGroup
    });

    // 区划定位的面板开关只是界面状态；关闭面板不清掉选择（ADR 0036）
    const regionPanelOpen = ref(false);
    const toggleRegionPanel = () => (regionPanelOpen.value = !regionPanelOpen.value);

    return () => (
      <div class={styles.root}>
        <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} />
        <MeasureOverlay measure={measure} />
        <div class={styles.controls}>
          <MapToolbar
            items={['default-view', 'browse', 'measure-distance', 'measure-area', 'clear', 'region-locate']}
            actions={{ 'default-view': goToDefaultView, clear: measure.clear, 'region-locate': toggleRegionPanel }}
            pressed={regionPanelOpen.value ? ['region-locate'] : []}
          />
          {regionPanelOpen.value && (
            <RegionLocatePanel region={region} onClose={() => (regionPanelOpen.value = false)} />
          )}
          <BasemapPanel basemap={basemap} />
          <BoundaryPanel boundaries={boundaries} />
        </div>
        <MapStatusNotice />
      </div>
    );
  }
});
