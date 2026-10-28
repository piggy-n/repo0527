import { geodesicDistance, type LngLat } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { computed, type ComputedRef } from 'vue';
import {
  belowSurface,
  SCALE_SAMPLE_WIDTH,
  type ScaleBar,
  scaleBar,
  type ViewAngles,
  visibleAngles
} from './status-bar';

/** 状态栏的经纬度 */
export interface ReadoutPosition {
  readonly lngLat: LngLat;
  /** 鼠标不在画布上，显示的是画布中心 */
  readonly center: boolean;
}

/** 状态栏的读数（ADR 0053 第 5 节）：视图不在就绪、拾取不到时比例尺和经纬度为 null */
export interface MapReadout {
  /** 二维的比例尺；三维为 null，显示视点高度（ADR 0080 第 6 节） */
  readonly scale: ComputedRef<ScaleBar | null>;
  /** 三维的视点高度，单位米；二维、视图不在就绪时为 null */
  readonly eye: ComputedRef<number | null>;
  readonly position: ComputedRef<ReadoutPosition | null>;
  readonly angles: ComputedRef<ViewAngles>;
  /** 步行时的第一视角：朝向（度，0～359 的整数）；不在步行时为 null，状态栏换成眼高和朝向（ADR 0086 第 5 节） */
  readonly firstPerson: ComputedRef<{ readonly heading: number } | null>;
}

/** 读数用到的上下文 */
export type ReadoutSource = Pick<MapContext, 'view' | 'pointer' | 'projectionRevision' | 'useCamera' | 'roamStatus'>;

/** 从地图上下文推导状态栏的读数，在组件的 setup 中调用；随鼠标、相机、画布尺寸和视图变化重新计算 */
export function useMapReadout(map: ReadoutSource): MapReadout {
  const camera = map.useCamera();

  // 画布中间的水平线上相距 100 像素的两点，按椭球面算距离；中心用相机的中心投影得到，不需要画布尺寸
  const scale = computed(() => {
    void map.projectionRevision.value;
    const view = map.view.value;
    if (view?.kind === '3d') {
      return null;
    }
    const center = view?.project(camera.value.center);
    if (!view || !center) {
      return null;
    }
    const half = SCALE_SAMPLE_WIDTH / 2;
    const left = view.pick({ x: center.x - half, y: center.y });
    const right = view.pick({ x: center.x + half, y: center.y });
    return left.kind === 'hit' && right.kind === 'hit' ? scaleBar(geodesicDistance(left.lngLat, right.lngLat)) : null;
  });

  // 相机每次变化时读一次，三维的相机变化每帧都写回会话
  const eye = computed(() => {
    void camera.value;
    return map.view.value?.eyeHeight() ?? null;
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
      // 视点在地表以下时，相机的中心是视线穿出椭球面的远处，不是画面中间看到的地方，不显示（原型 `/dev/map-3d`）
      const height = eye.value;
      return height !== null && belowSurface(height) ? null : { lngLat: camera.value.center, center: true };
    }
    const picked = view.pick(pointer);
    return picked.kind === 'hit' ? { lngLat: picked.lngLat, center: false } : null;
  });

  const angles = computed(() => visibleAngles(camera.value));

  // 朝向读视图的相机：视点在地下时会话的方位按画布中心对着的地面点算，不可靠
  const firstPerson = computed(() => {
    void camera.value;
    const status = map.roamStatus.value;
    const heading = map.view.value?.heading() ?? null;
    if (status?.kind !== 'walk' || status.phase !== 'walking' || heading === null) {
      return null;
    }
    return { heading: Math.round(heading) % 360 };
  });

  return { scale, eye, position, angles, firstPerson };
}
