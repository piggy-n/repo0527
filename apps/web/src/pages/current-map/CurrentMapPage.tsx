import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent } from 'vue';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { useDefaultView } from '@/shared/map/useDefaultView';
import styles from './CurrentMapPage.module.scss';

/** 现状底图：联调用的骨架，界面在 5D 专门设计（docs/roadmap.md"阶段五"） */
export const CurrentMapPage = defineComponent({
  name: 'CurrentMapPage',
  setup() {
    // 注记单独成组，以后边界放在它下面、资源图层放在它上面（ADR 0031）
    const map = provideMap({ groups: ['basemap', 'basemap-labels'], camera: JIANGSU_CAMERA });
    const basemap = useBasemap();
    map.bindStyle({ basemap: basemap.deriveGroup, 'basemap-labels': basemap.deriveLabelsGroup });

    // 第一次就绪时按江苏的范围定位；回到默认视角的入口在工具栏（5B.3）
    useDefaultView(map);

    return () => (
      <div class={styles.root}>
        <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} />
        <BasemapPanel class={styles.basemapPanel} basemap={basemap} />
        <MapStatusNotice />
      </div>
    );
  }
});
