import { computed, type ComputedRef, type Ref, shallowRef, watch } from 'vue';
import type { SimulationVersion } from '../engine/engine';
import {
  type MapColoring,
  mapColoring,
  type Rank,
  rankOf,
  resolveSelection,
  type ResultItem,
  resultItems,
  type ResultSelection
} from '../result/result-view';
import type { SimulationRun } from './useSimulationRun';

/** 结果展示的拥有者：看哪项指标、哪一年、怎么着色、放大到哪个市，以及悬停的市；结果总是最新的一版 */
export interface SimulationResult {
  /** 还没有结果时为 null */
  readonly selection: ComputedRef<ResultSelection | null>;
  readonly version: ComputedRef<SimulationVersion | null>;
  /** 左侧每项指标的结果 */
  readonly items: ComputedRef<readonly ResultItem[]>;
  /** 选中指标的各市（一个市时是各区县）结果 */
  readonly rank: ComputedRef<Rank | null>;
  readonly coloring: ComputedRef<MapColoring | null>;
  /** 悬停中的市：地图上描出它的边界 */
  readonly hoverCity: Readonly<Ref<string | null>>;
  /** 改选择；不在条件里的指标、年度、市抛错 */
  readonly select: (patch: Partial<ResultSelection>) => void;
  readonly setHoverCity: (cityCode: string | null) => void;
}

export function useSimulationResult(run: SimulationRun): SimulationResult {
  const state = run.state;
  // 只存用户选过的；重新推演后还在条件里的沿用（resolveSelection），回到条件编排时清空
  const chosen = shallowRef<Partial<ResultSelection>>({});
  const hoverCity = shallowRef<string | null>(null);
  watch(
    () => state.value.status === 'idle',
    idle => {
      if (idle) {
        chosen.value = {};
        hoverCity.value = null;
      }
    }
  );

  const version = computed(() => state.value.versions.at(-1) ?? null);
  const selection = computed(() => resolveSelection(state.value, chosen.value));
  const items = computed(() => {
    const { conditions } = state.value;
    const current = selection.value;
    return version.value && conditions && current ? resultItems(version.value, conditions, current.year) : [];
  });
  const rank = computed(() => {
    const { conditions } = state.value;
    const current = selection.value;
    return version.value && conditions && current ? rankOf(version.value, conditions, current.indicatorId, current.year) : null;
  });
  const coloring = computed(() => {
    const calculator = run.calculator.value;
    const { conditions } = state.value;
    const current = selection.value;
    return calculator && version.value && conditions && current ? mapColoring(calculator, conditions, current, version.value) : null;
  });

  return {
    selection,
    version,
    items,
    rank,
    coloring,
    hoverCity,
    select: patch => {
      const current = selection.value;
      const { conditions } = state.value;
      if (!current || !conditions) {
        throw new Error('还没有计算结果');
      }
      const next = { ...current, ...patch };
      if (
        !conditions.indicatorIds.includes(next.indicatorId) ||
        !conditions.years.includes(next.year) ||
        (next.cityCode !== null && !conditions.cityCodes.includes(next.cityCode))
      ) {
        throw new Error(`计算条件里没有指标 ${next.indicatorId}、${next.year} 年或市 ${next.cityCode}`);
      }
      chosen.value = next;
    },
    setHoverCity: cityCode => {
      hoverCity.value = cityCode;
    }
  };
}
