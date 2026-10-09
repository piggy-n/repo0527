import type { StyleGroup } from '@yzt/map-core';
import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent, onMounted, onUnmounted } from 'vue';
import { JIANGSU_BOUNDS, JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import styles from './CurrentMapPage.module.scss';

// 临时的底图，5B.1 换成天地图底图的拥有者；地图样式里的颜色是数据，不走 CSS 令牌
const TEMPORARY_BASEMAP: StyleGroup = {
  sources: {},
  layers: [{ id: 'basemap-background', type: 'background', paint: { 'background-color': '#eef2f7' } }]
};

/** 现状底图：联调用的骨架，界面在 5D 专门设计（docs/roadmap.md"阶段五"） */
export const CurrentMapPage = defineComponent({
  name: 'CurrentMapPage',
  setup() {
    const map = provideMap({ groups: ['basemap'], camera: JIANGSU_CAMERA });
    map.bindStyle({ basemap: () => TEMPORARY_BASEMAP });

    // 进入页面后按江苏的范围定位：不同屏幕尺寸下都完整显示，并避开悬浮元素
    const entering = new AbortController();
    const fitOnEnter = async () => {
      try {
        await map.whenReady(entering.signal);
      } catch {
        // 页面已卸载，或者视图失败（由 MapStatusNotice 提示）：不定位
        return;
      }
      map.view.value?.fitBounds(JIANGSU_BOUNDS, { duration: 0 });
    };
    onMounted(() => void fitOnEnter());
    onUnmounted(() => entering.abort());

    return () => (
      <div class={styles.root}>
        <MapCanvas />
        <MapStatusNotice />
      </div>
    );
  }
});
