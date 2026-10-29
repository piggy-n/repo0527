import { usePreferredReducedMotion } from '@vueuse/core';
import type { LngLat, StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { computed, type ComputedRef, type Ref, ref, watch } from 'vue';
import { formatValue } from '../format';
import { districtBounds, type MapData, mapData } from '../map/map-data';
import { alertsGroup, districtsGroup, facilitiesGroup, type MapFrame, mapFrame, maskGroup } from '../map/map-frame';
import { simulationIndicator } from '../model/indicators';
import { primaryIndicator } from '../run/narrative';
import { inProgress } from '../run/run-view';
import type { SimulationRun } from './useSimulationRun';

/** 地图上的文字标注：缺失人口的区县、评价后的城市值 */
export interface MapLabel {
  readonly key: string;
  readonly lngLat: LngLat;
  readonly text: string;
  readonly kind: 'missing' | 'city';
  /** 城市值是否达标 */
  readonly pass?: boolean;
}

/** 镜头跟随推演的几个位置：推演范围、缺失的区县、空间分析的样例 */
type CameraCue = 'scope' | 'missing' | 'sample';

export interface SimulationMap {
  readonly data: Readonly<Ref<MapData | null>>;
  readonly frame: Readonly<Ref<MapFrame | null>>;
  readonly labels: ComputedRef<readonly MapLabel[]>;
  /** 扫描带所在的经度；不在扫描时为 null */
  readonly scanLng: ComputedRef<number | null>;
  /** 镜头是否跟随推演；用户自己移动地图后停止 */
  readonly following: Readonly<Ref<boolean>>;
  readonly stopFollowing: () => void;
  readonly resumeFollowing: () => void;
  readonly deriveDistricts: () => StyleGroup;
  readonly deriveMask: () => StyleGroup;
  readonly deriveFacilities: () => StyleGroup;
  readonly deriveAlerts: () => StyleGroup;
}

const sameFrame = (a: MapFrame | null, b: MapFrame | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.density === b.density &&
    a.scan === b.scan &&
    a.rain === b.rain &&
    a.ring === b.ring &&
    a.alert?.kind === b.alert?.kind &&
    a.alert?.opacity === b.alert?.opacity);

/** 推演的地图：数据每轮换一次，演出按步骤进度逐帧推导；镜头在推演的几个关键处移动，用户移动地图后停止跟随 */
export function useSimulationMap(run: SimulationRun, map: Pick<MapContext, 'runCameraOperation'>): SimulationMap {
  const state = run.state;
  const motion = usePreferredReducedMotion();
  const conditions = computed(() => state.value.conditions);
  const params = computed(() => state.value.params);
  const active = computed(() => state.value.status !== 'idle');

  const data = computed((): MapData | null => {
    const calculator = run.calculator.value;
    if (!active.value || !calculator || !conditions.value) {
      return null;
    }
    return mapData(calculator, conditions.value, params.value, primaryIndicator(conditions.value));
  });

  // 每帧都会重新计算，值没变时保留原来的对象，样式不重新推导
  let last: MapFrame | null = null;
  const frame = computed((): MapFrame | null => {
    const next = active.value ? mapFrame(state.value, run.progress) : null;
    if (!sameFrame(last, next)) {
      last = next;
    }
    return last;
  });

  const labels = computed((): MapLabel[] => {
    const current = data.value;
    const now = frame.value;
    if (!current || !now || !conditions.value) {
      return [];
    }
    if (now.alert?.kind === 'missing') {
      return current.missing.map(district => ({
        key: district.code,
        lngLat: district.center,
        text: `${district.name} · 人口缺失`,
        kind: 'missing'
      }));
    }
    const evaluated = ['done', 'reused'].includes(state.value.steps.evaluate.status);
    if (!evaluated) {
      return [];
    }
    const indicator = simulationIndicator(primaryIndicator(conditions.value));
    return current.cities.map(city => ({
      key: city.code,
      lngLat: city.center,
      text: `${city.name.replace(/市$/, '')} ${formatValue(city.value, indicator)}`,
      kind: 'city',
      pass: city.pass
    }));
  });

  const scanLng = computed(() => {
    const current = data.value;
    const scan = frame.value?.scan;
    if (!current || scan === undefined || scan === null || scan >= 1) {
      return null;
    }
    const [west, , east] = current.bounds;
    return west + scan * (east - west);
  });

  // ---- 镜头 ----
  const following = ref(true);
  const cue = computed((): CameraCue | null => {
    const now = state.value;
    if (!inProgress(now.status)) {
      return null;
    }
    if (now.checkpoint?.step === 'qc') {
      return 'missing';
    }
    return now.steps.spatial.status === 'running' ? 'sample' : 'scope';
  });

  const moveTo = (target: CameraCue) => {
    const current = data.value;
    if (!current) {
      return;
    }
    const duration = motion.value === 'reduce' ? 0 : 900;
    if (target === 'missing' && current.missing.length > 0) {
      const bounds = districtBounds(current.missing);
      map.runCameraOperation(camera => camera.fitBounds(bounds, { maxZoom: 9, duration }));
      return;
    }
    if (target === 'sample' && current.sample) {
      const zoom = current.ringMeters > 1500 ? 10.6 : 12.2;
      const center = current.sample.center;
      const flight = motion.value === 'reduce' ? 0 : 1600;
      map.runCameraOperation(camera => camera.flyTo({ center, zoom }, { duration: flight }));
      return;
    }
    map.runCameraOperation(camera => camera.fitBounds(current.bounds, { maxZoom: 10, duration }));
  };

  watch(cue, next => {
    if (next !== null && following.value) {
      moveTo(next);
    }
  });
  // 开始新的一轮推演时重新跟随
  watch(
    () => state.value.status === 'planning',
    planning => {
      if (planning) {
        following.value = true;
      }
    }
  );

  return {
    data,
    frame,
    labels,
    scanLng,
    following,
    stopFollowing: () => {
      following.value = false;
    },
    resumeFollowing: () => {
      following.value = true;
      if (cue.value !== null) {
        moveTo(cue.value);
      } else if (data.value) {
        moveTo('scope');
      }
    },
    deriveDistricts: () => districtsGroup(data.value, frame.value),
    deriveMask: () => maskGroup(data.value),
    deriveFacilities: () => facilitiesGroup(data.value, frame.value),
    deriveAlerts: () => alertsGroup(data.value, frame.value)
  };
}
