import { geodesicDistance, type LngLat } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { computed, type ComputedRef } from 'vue';
import { SCALE_SAMPLE_WIDTH, type ScaleBar, scaleBar, type ViewAngles, visibleAngles } from './status-bar';

/** 状态栏的经纬度 */
export interface ReadoutPosition {
  readonly lngLat: LngLat;
  /** 鼠标不在画布上，显示的是画布中心 */
  readonly center: boolean;
}

/** 状态栏的读数（ADR 0053 第 5 节）：视图不在就绪、拾取不到时比例尺和经纬度为 null */
export interface MapReadout {
  readonly scale: ComputedRef<ScaleBar | null>;
  readonly position: ComputedRef<ReadoutPosition | null>;
  readonly angles: ComputedRef<ViewAngles>;
}

/** 读数用到的上下文 */
export type ReadoutSource = Pick<MapContext, 'view' | 'pointer' | 'projectionRevision' | 'useCamera'>;

/** 从地图上下文推导状态栏的读数，在组件的 setup 中调用；随鼠标、相机、画布尺寸和视图变化重新计算 */
export function useMapReadout(map: ReadoutSource): MapReadout {
  const camera = map.useCamera();

  // 画布中间的水平线上相距 100 像素的两点，按椭球面算距离；中心用相机的中心投影得到，不需要画布尺寸
  const scale = computed(() => {
    void map.projectionRevision.value;
    const view = map.view.value;
    const center = view?.project(camera.value.center);
    if (!view || !center) {
      return null;
    }
    const half = SCALE_SAMPLE_WIDTH / 2;
    const left = view.pick({ x: center.x - half, y: center.y });
    const right = view.pick({ x: center.x + half, y: center.y });
    return left.kind === 'hit' && right.kind === 'hit' ? scaleBar(geodesicDistance(left.lngLat, right.lngLat)) : null;
  });

  // 鼠标在画布上时拾取它下面的点；不在时是画布中心，也就是相机的中心
  const position = computed((): ReadoutPosition | null => {
    void map.projectionRevision.value;
    const view = map.view.value;
    if (!view) {
      return null;
    }
    const pointer = map.pointer.value;
    if (!pointer) {
      return { lngLat: camera.value.center, center: true };
    }
    const picked = view.pick(pointer);
    return picked.kind === 'hit' ? { lngLat: picked.lngLat, center: false } : null;
  });

  const angles = computed(() => visibleAngles(camera.value));

  return { scale, position, angles };
}
