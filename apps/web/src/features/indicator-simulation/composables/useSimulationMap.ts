import type { LngLat, StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { computed, type ComputedRef, type Ref, watch } from 'vue';
import { formatValue } from '../format';
import { indicatorResult } from '../model/analysis';
import { type MapData, mapData } from '../map/map-data';
import { districtsGroup, facilitiesGroup, highlightGroup, type MapFrame, maskGroup } from '../map/map-frame';
import { simulationIndicator } from '../model/indicators';
import { reducedMotion } from '../motion';
import type { SimulationResult } from './useSimulationResult';
import type { SimulationRun } from './useSimulationRun';

/** 地图上的城市标注：点了放大到这个市 */
export interface MapLabel {
  readonly cityCode: string;
  readonly lngLat: LngLat;
  /** 去掉"市"的名称 */
  readonly name: string;
  readonly value: string;
}

/** 鼠标下的区县：名称和值 */
export interface DistrictHint {
  readonly name: string;
  readonly text: string;
}

export interface SimulationMap {
  /** 结果的地图数据；还没有结果时为 null */
  readonly data: Readonly<Ref<MapData | null>>;
  readonly labels: ComputedRef<readonly MapLabel[]>;
  /** 推演范围里的区县的提示；不在范围里、没有结果时为 null */
  readonly describeDistrict: (code: string) => DistrictHint | null;
  readonly deriveDistricts: () => StyleGroup;
  readonly deriveMask: () => StyleGroup;
  readonly deriveFacilities: () => StyleGroup;
  readonly deriveHighlight: () => StyleGroup;
}

// 结果的地图：数值全部显示，设施和服务圈都在
const SHOWN: MapFrame = { density: null, scan: 1, rain: 1, ring: 1 };

/**
 * 结果展示的地图：按结果的选择显示（指标、年度），各市标出值，悬停的市描边；
 * 放大到一个市时画设施和服务圈；有了结果时镜头移到推演范围，放大到一个市时移到这个市，回到整个范围时再移回来
 */
export function useSimulationMap(
  run: SimulationRun,
  map: Pick<MapContext, 'runCameraOperation'>,
  result: SimulationResult
): SimulationMap {
  const state = run.state;
  const conditions = computed(() => state.value.conditions);

  // 完成时才显示：重新推演的过程中看流程图，地图不跟着变
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
    return mapData(calculator, conditions.value, version.params, selection.indicatorId, {
      year: selection.year,
      fill: coloring.fill
    });
  });
  const frame = computed(() => (data.value === null ? null : SHOWN));
  // 设施和服务圈只在放大到一个市（或范围只有一个市）时画：按级别分不开，两个市的范围和一个市只差半级
  const focused = computed(() => {
    const current = viewing.value;
    return current !== null && (current.selection.cityCode !== null || conditions.value?.cityCodes.length === 1);
  });

  const labels = computed((): MapLabel[] => {
    const selection = viewing.value?.selection;
    if (!data.value || !selection) {
      return [];
    }
    const indicator = simulationIndicator(selection.indicatorId);
    return data.value.cities.map(city => ({
      cityCode: city.code,
      lngLat: city.center,
      name: city.name.replace(/市$/, ''),
      value: formatValue(city.value, indicator)
    }));
  });

  // 区县的值按选择的指标和年度
  const districts = computed(() => {
    const current = viewing.value;
    if (!current) {
      return new Map<string, DistrictHint>();
    }
    const { indicatorId, year } = current.selection;
    const indicator = simulationIndicator(indicatorId);
    const outcome = indicatorResult(current.version.result[year]?.indicators ?? {}, indicatorId);
    return new Map(
      outcome.rows.map((row): [string, DistrictHint] => [
        row.code,
        { name: row.name, text: formatValue(row.value, indicator) }
      ])
    );
  });

  // 有了结果（第一次，或重新推演完成）、换放大的市时移镜头；换指标、年度时不动
  watch(
    [() => (viewing.value ? conditions.value : null), () => viewing.value?.selection.cityCode ?? null],
    ([next, cityCode]) => {
      const current = data.value;
      if (!next || !current) {
        return;
      }
      const city = current.cities.find(item => item.code === cityCode);
      const duration = reducedMotion() ? 0 : 900;
      map.runCameraOperation(camera =>
        camera.fitBounds(city ? city.bounds : current.bounds, { maxZoom: city ? 11 : 10, duration })
      );
    }
  );

  return {
    data,
    labels,
    describeDistrict: code => districts.value.get(code) ?? null,
    deriveDistricts: () => districtsGroup(data.value, frame.value),
    deriveMask: () => maskGroup(data.value),
    deriveFacilities: () => facilitiesGroup(focused.value ? data.value : null, frame.value),
    deriveHighlight: () => highlightGroup(data.value, result.hoverCity.value)
  };
}
