import { ElButton } from 'element-plus';
import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent } from 'vue';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundaryPanel } from '@/shared/map/boundary/BoundaryPanel';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { useDefaultView } from '@/shared/map/useDefaultView';
import styles from './CurrentMapPage.module.scss';

/** 现状底图：联调用的骨架，界面在 5D 专门设计（docs/roadmap.md"阶段五"） */
export const CurrentMapPage = defineComponent({
  name: 'CurrentMapPage',
  setup() {
    // 边界压在注记上面；以后资源图层放在两者之间（ADR 0033 第 4 条）
    const map = provideMap({ groups: ['basemap', 'basemap-labels', 'boundaries'], camera: JIANGSU_CAMERA });
    const basemap = useBasemap();
    const boundaries = useBoundaries();
    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      boundaries: boundaries.deriveGroup
    });

    // 第一次就绪时按江苏的范围定位；回到默认视角的按钮是临时的，5B.3 换成工具栏
    const { goToDefaultView } = useDefaultView(map);

    return () => (
      <div class={styles.root}>
        <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} />
        <div class={styles.controls}>
          <ElButton onClick={goToDefaultView}>默认视角</ElButton>
          <BasemapPanel basemap={basemap} />
          <BoundaryPanel boundaries={boundaries} />
        </div>
        <MapStatusNotice />
      </div>
    );
  }
});
