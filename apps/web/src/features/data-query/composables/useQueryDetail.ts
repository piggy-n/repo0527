import { skipToken, useQuery } from '@tanstack/vue-query';
import { bbox } from '@turf/bbox';
import type { MapContext } from '@yzt/map-vue';
import { computed, watch } from 'vue';
import { isFeatureGuid, queryFeatureGeometries } from '@/shared/map/feature-geometry';
import { geometryTextSchema } from '@/shared/map/geometry-schema';
import type { QueryRecord } from '../api';
import { dataQueryKeys } from '../queries';
import type { QuerySnapshot } from '../types';
import type { DataQuery } from './useDataQuery';

// 结果行带了几何就直接用，否则按主键读取完整几何
async function recordGeometry(snapshot: QuerySnapshot, record: QueryRecord, signal: AbortSignal) {
  if (record.geom !== undefined) {
    return geometryTextSchema.parse(record.geom);
  }
  if (!isFeatureGuid(record.guid)) {
    throw new Error('该记录没有可用的定位信息');
  }
  const rows = await queryFeatureGeometries(snapshot.layer.code, record.guid, signal);
  if (rows.length !== 1 || rows[0].guid !== record.guid) {
    throw new Error('未找到该记录的唯一几何');
  }
  return rows[0].geom;
}

type RecordGeometry = Awaited<ReturnType<typeof recordGeometry>>;

/** 属性直接来自结果行，几何按主键获取；旧行的迟到几何不定位新选择 */
export function useQueryDetail(map: MapContext, model: DataQuery) {
  const geometryQuery = useQuery(computed(() => {
    const record = model.selected.value;
    const snapshot = model.submitted.value;
    return {
      queryKey: dataQueryKeys.detail(snapshot?.id ?? '', record),
      queryFn: record && snapshot
        ? ({ signal }: { signal: AbortSignal }) => recordGeometry(snapshot, record, signal)
        : skipToken,
      gcTime: 0,
      select: (geometry: RecordGeometry) => ({ record, geometry })
    };
  }));
  const geometry = computed(() => {
    const data = geometryQuery.data.value;
    return data?.record === model.selected.value ? data?.geometry : undefined;
  });
  // 相机操作在用户选行时开始；等待过程中主动拖图会作废这次定位
  let operation = map.currentCameraOperation();
  watch(
    model.selected,
    () => {
      operation = map.beginCameraOperation();
    },
    { flush: 'sync' }
  );
  watch(geometry, shape => {
    if (!shape) {
      return;
    }
    const [west, south, east, north] = bbox(shape);
    operation.run(camera => camera.fitBounds([west, south, east, north], { maxZoom: 16, duration: 600, pitch: 0 }));
  });

  // 重试是新的定位意图，不复用可能已被拖图作废的相机操作
  function retry() {
    operation = map.beginCameraOperation();
    void geometryQuery.refetch();
  }

  return { geometryQuery, geometry, retry };
}
