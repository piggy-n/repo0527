import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent, watch } from 'vue';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { JIANGSU_BOUNDS, JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import styles from './CurrentMapPage.module.scss';

/** 现状底图：联调用的骨架，界面在 5D 专门设计（docs/roadmap.md"阶段五"） */
export const CurrentMapPage = defineComponent({
  name: 'CurrentMapPage',
  setup() {
    // 注记单独成组，以后边界放在它下面、资源图层放在它上面（ADR 0031）
    const map = provideMap({ groups: ['basemap', 'basemap-labels'], camera: JIANGSU_CAMERA });
    const basemap = useBasemap();
    map.bindStyle({ basemap: basemap.deriveGroup, 'basemap-labels': basemap.deriveLabelsGroup });

    // 本次进入页面后第一次就绪时按江苏的范围定位一次（首次失败、重试成功后同样补做），之后不再覆盖用户调整过的视角；
    // 不同屏幕尺寸下都完整显示，并避开悬浮元素。页面卸载时侦听器随之停止
    const stopInitialFit = watch(map.viewState, state => {
      if (state === 'ready' && map.view.value) {
        stopInitialFit();
        map.view.value.fitBounds(JIANGSU_BOUNDS, { duration: 0 });
      }
    });

    return () => (
      <div class={styles.root}>
        <MapCanvas />
        <BasemapPanel class={styles.basemapPanel} basemap={basemap} />
        <MapStatusNotice />
      </div>
    );
  }
});
