import type { LngLat, StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { computed, type ComputedRef, type Ref, watch } from 'vue';
import { formatValue } from '../format';
import type { PassState } from '../model/analysis';
import { type MapData, mapData } from '../map/map-data';
import { alertsGroup, districtsGroup, facilitiesGroup, type MapFrame, maskGroup } from '../map/map-frame';
import { simulationIndicator } from '../model/indicators';
import { reducedMotion } from '../motion';
import type { SimulationResult } from './useSimulationResult';
import type { SimulationRun } from './useSimulationRun';

/** 地图上的文字标注：各市的值 */
export interface MapLabel {
  readonly key: string;
  readonly lngLat: LngLat;
  readonly text: string;
  /** 城市值的达标状态 */
  readonly state: PassState;
}

export interface SimulationMap {
  /** 正在看的一版的地图数据；还没有结果时为 null */
  readonly data: Readonly<Ref<MapData | null>>;
  readonly labels: ComputedRef<readonly MapLabel[]>;
  readonly deriveDistricts: () => StyleGroup;
  readonly deriveMask: () => StyleGroup;
  readonly deriveFacilities: () => StyleGroup;
  readonly deriveAlerts: () => StyleGroup;
}

// 结果的地图：数值全部显示，设施和服务圈都在
const SHOWN: MapFrame = { density: null, scan: 1, rain: 1, ring: 1, alert: null };
const PREVIEWING: MapFrame = { ...SHOWN, alert: { kind: 'preview', opacity: 1 } };

/**
 * 结果展示的地图：按结果的选择显示（哪一版、年度、着色），人工干预的预览描虚线，各市标出值和达标；
 * 推演阶段不显示地图（原型 v4），有了结果时镜头移到推演范围
 */
export function useSimulationMap(
  run: SimulationRun,
  map: Pick<MapContext, 'runCameraOperation'>,
  result: SimulationResult
): SimulationMap {
  const state = run.state;
  const conditions = computed(() => state.value.conditions);

  // 结果阶段看的一版：完成时有选择才算
  const viewing = computed(() => {
    const selection = result.selection.value;
    const version = result.version.value;
    const coloring = result.coloring.value;
    return state.value.status === 'done' && selection && version && coloring ? { selection, version, coloring } : null;
  });

  const data = computed((): MapData | null => {
    const calculator = run.calculator.value;
    const current = viewing.value;
    if (!calculator || !conditions.value || !current) {
      return null;
    }
    const { selection, version, coloring } = current;
    const preview = result.preview.value;
    return mapData(calculator, conditions.value, version.params, selection.indicatorId, {
      year: selection.year,
      fill: coloring.fill,
      preview: preview.size > 0 ? preview : undefined
    });
  });
  const frame = computed(() => (data.value === null ? null : result.preview.value.size > 0 ? PREVIEWING : SHOWN));

  const labels = computed((): MapLabel[] => {
    const current = data.value;
    const selection = viewing.value?.selection;
    if (!current || !selection) {
      return [];
    }
    const indicator = simulationIndicator(selection.indicatorId);
    return current.cities.map(city => ({
      key: city.code,
      lngLat: city.center,
      text: `${city.name.replace(/市$/, '')} ${formatValue(city.value, indicator)}`,
      state: city.state
    }));
  });

  // 有了结果（第一版，或换条件后的新一轮）时，镜头移到推演范围：重新推演时先回到没有结果，换版本、换选择时条件不变
  watch(
    () => (viewing.value ? conditions.value : null),
    next => {
      const current = data.value;
      if (next && current) {
        map.runCameraOperation(camera => camera.fitBounds(current.bounds, { maxZoom: 10, duration: reducedMotion() ? 0 : 900 }));
      }
    }
  );

  return {
    data,
    labels,
    deriveDistricts: () => districtsGroup(data.value, frame.value),
    deriveMask: () => maskGroup(data.value),
    deriveFacilities: () => facilitiesGroup(data.value, frame.value),
    deriveAlerts: () => alertsGroup(data.value, frame.value)
  };
}
