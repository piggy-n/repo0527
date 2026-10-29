import { type Ref, shallowRef } from 'vue';
import type { SimulationParams } from '../model/params';
import {
  type Composition,
  defaultComposition,
  emptyComposition,
  withAllCities,
  withCity,
  withIndicator,
  withIndicatorMoved,
  withParams,
  withYear
} from '../compose/composition';

/** 编排的拥有者：条件库和编排图只显示和调用 */
export interface CompositionOwner {
  readonly state: Readonly<Ref<Composition>>;
  toggleYear(year: number): void;
  /** 拖入年度；已经有了返回 false */
  addYear(year: number): boolean;
  removeYear(year: number): void;
  toggleCity(code: string): void;
  /** 拖入一个市；已经有了返回 false */
  addCity(code: string): boolean;
  removeCity(code: string): void;
  setAllCities(on: boolean): void;
  toggleIndicator(id: string): void;
  /** 拖入指标，排在最后；已经有了返回 false */
  addIndicator(id: string): boolean;
  removeIndicator(id: string): void;
  /** 把第 from 项指标移到第 to 项 */
  moveIndicator(from: number, to: number): void;
  setParams(params: SimulationParams): void;
  /** 清空条件，参数回到默认 */
  clear(): void;
}

export function useComposition(initial: Composition = defaultComposition()): CompositionOwner {
  const state = shallowRef(initial);
  const set = (next: Composition) => {
    if (next !== state.value) {
      state.value = next;
    }
  };
  const hasYear = (year: number) => state.value.conditions.years.includes(year);
  const hasCity = (code: string) => state.value.conditions.cityCodes.includes(code);
  const hasIndicator = (id: string) => state.value.conditions.indicatorIds.includes(id);

  // 加上一项：已经有了不改状态，返回 false
  const add = (has: boolean, next: () => Composition) => {
    if (has) {
      return false;
    }
    set(next());
    return true;
  };
  const remove = (has: boolean, next: () => Composition) => {
    if (has) {
      set(next());
    }
  };

  return {
    state,
    toggleYear: year => set(withYear(state.value, year, !hasYear(year))),
    addYear: year => add(hasYear(year), () => withYear(state.value, year, true)),
    removeYear: year => remove(hasYear(year), () => withYear(state.value, year, false)),
    toggleCity: code => set(withCity(state.value, code, !hasCity(code))),
    addCity: code => add(hasCity(code), () => withCity(state.value, code, true)),
    removeCity: code => remove(hasCity(code), () => withCity(state.value, code, false)),
    setAllCities: on => set(withAllCities(state.value, on)),
    toggleIndicator: id => set(withIndicator(state.value, id, !hasIndicator(id))),
    addIndicator: id => add(hasIndicator(id), () => withIndicator(state.value, id, true)),
    removeIndicator: id => set(withIndicator(state.value, id, false)),
    moveIndicator: (from, to) => {
      if (from !== to) {
        set(withIndicatorMoved(state.value, from, to));
      }
    },
    setParams: params => set(withParams(state.value, params)),
    clear: () => set(emptyComposition())
  };
}
