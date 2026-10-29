import { bbox } from '@turf/bbox';
import { computed, type ComputedRef, type ShallowRef, shallowReadonly, shallowRef } from 'vue';
import type { DrawnShape } from '@/shared/map/draw/shape-draw';
import { type ShapeDraw, useShapeDraw } from '@/shared/map/draw/useShapeDraw';
import { queryGeometry } from '@/shared/map/query-geometry';
import { layerOf, type QueryLayer, type QueryTopic } from '../topics';
import type { FormCheck } from './useAttributeForm';

/** 上传的 shp：id 每选一次加 1，查询缓存按它区分不同的文件 */
export interface ShpFile {
  readonly id: number;
  readonly file: File;
}

/** 空间查询的范围：画的框、多边形，或者上传的 shp；最后选的那个生效 */
export type SpatialScope =
  | { readonly kind: 'shape'; readonly shape: DrawnShape }
  | { readonly kind: 'shp'; readonly file: ShpFile };

export interface SpatialFormOptions {
  /** 开始画新的范围：上一次的结果作废 */
  readonly onDrawStart?: () => void;
  /** 画完一个范围；已选图层时页面据此直接查询（同旧页面） */
  readonly onDrawComplete?: () => void;
}

/** 空间查询的表单：图层和范围；画范围用 shared/map 的绘制工具，页面登记它的工具 */
export interface SpatialForm {
  readonly layer: Readonly<ShallowRef<QueryLayer | null>>;
  readonly draw: ShapeDraw;
  readonly scope: ComputedRef<SpatialScope | null>;
  readonly setLayer: (table: string) => void;
  /** 选了 shp 文件：画的范围清掉 */
  readonly chooseFile: (file: File) => void;
  /** 清掉画的范围和文件，正在画的方式保留 */
  readonly clearScope: () => void;
  readonly reset: () => void;
  readonly check: () => FormCheck;
}

export function useSpatialForm(
  map: Parameters<typeof useShapeDraw>[0],
  topic: QueryTopic,
  options: SpatialFormOptions = {}
): SpatialForm {
  const layer = shallowRef<QueryLayer | null>(null);
  const file = shallowRef<ShpFile | null>(null);
  let nextFileId = 1;
  const draw = useShapeDraw(map, {
    onStart: () => {
      file.value = null;
      options.onDrawStart?.();
    },
    onComplete: () => options.onDrawComplete?.()
  });

  const scope = computed((): SpatialScope | null => {
    const shape = draw.shape.value;
    if (shape) {
      return { kind: 'shape', shape };
    }
    return file.value ? { kind: 'shp', file: file.value } : null;
  });

  // 还没有范围时按正在用的方式提示（同旧页面）
  const missingScope = () => {
    const active = draw.active.value;
    if (active === null) {
      return '请先选择空间查询方式';
    }
    return active === 'rectangle' ? '请先完成框选' : '请先完成多边形绘制';
  };

  return {
    layer: shallowReadonly(layer),
    draw,
    scope,
    setLayer: table => {
      layer.value = layerOf(topic, table) ?? null;
    },
    chooseFile: selected => {
      draw.clear();
      file.value = { id: nextFileId++, file: selected };
    },
    clearScope: () => {
      draw.clear();
      file.value = null;
    },
    reset: () => {
      draw.stop();
      draw.clear();
      layer.value = null;
      file.value = null;
    },
    check: () => {
      const current = scope.value;
      if (layer.value === null) {
        return { ok: false, reason: '未选择图层' };
      }
      if (current === null) {
        return { ok: false, reason: missingScope() };
      }
      const layerCode = layer.value.table;
      if (current.kind === 'shp') {
        return { ok: true, request: { kind: 'shp', layerCode, fileId: current.file.id, file: current.file.file } };
      }
      // 发给后端的几何都要整理（ADR 0051 第 4 节）：自相交的多边形整理不出来
      const geometry = queryGeometry(current.shape.polygon, current.shape.pixelSize);
      if (geometry === null) {
        return { ok: false, reason: '画的范围太复杂或自相交，请重新绘制' };
      }
      const [west, south, east, north] = bbox(geometry);
      return {
        ok: true,
        request: { kind: 'geometry', layerCode, geometry: JSON.stringify(geometry), bounds: [west, south, east, north] }
      };
    }
  };
}
