import { type Ref, shallowRef } from 'vue';
import type { SimulationParams } from '../model/params';
import { type ScopeArea, type ScopeKind, scopeCityCodes } from '../model/scope';
import {
  type Composition,
  emptyComposition,
  withAllCities,
  withArea,
  withCity,
  withIndicator,
  withIndicatorMoved,
  withScopeKind,
  withYear
} from '../compose/composition';

/** 编排的拥有者：条件库、编排图和 AI 推演指令只显示和调用 */
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
  /** 切换范围的种类：行政区划或自定义范围，恢复这种范围上一次的选择 */
  setScopeKind(kind: ScopeKind): void;
  /** 换上自定义范围并切到自定义范围；null 是移除 */
  setArea(area: ScopeArea | null): void;
  toggleIndicator(id: string): void;
  /** 拖入指标，排在最后；已经有了返回 false */
  addIndicator(id: string): boolean;
  removeIndicator(id: string): void;
  /** 把第 from 项指标移到第 to 项 */
  moveIndicator(from: number, to: number): void;
  setParams(params: SimulationParams): void;
  /** 整体换成另一个编排：AI 推演指令一列一列填入时用 */
  replace(next: Composition): void;
  /** 重置条件：清空条件，参数回到标准口径 */
  reset(): void;
}

/** 编排的拥有者；打开页面时是空的，由 AI 推演指令或手动点选编排 */
export function useComposition(initial: Composition = emptyComposition()): CompositionOwner {
  const state = shallowRef(initial);
  const set = (next: Composition) => {
    if (next !== state.value) {
      state.value = next;
    }
  };
  const hasYear = (year: number) => state.value.conditions.years.includes(year);
  // 按市点选、拖入表示用行政区划：在自定义范围下先切回行政区划（恢复上一次选的市）
  const cities = () => withScopeKind(state.value, 'cities');
  const hasCity = (code: string) => scopeCityCodes(cities().conditions.scope).includes(code);
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
    toggleCity: code => set(withCity(cities(), code, !hasCity(code))),
    addCity: code => {
      if (state.value.conditions.scope.kind !== 'cities') {
        set(cities());
      }
      return add(hasCity(code), () => withCity(state.value, code, true));
    },
    removeCity: code => remove(hasCity(code), () => withCity(cities(), code, false)),
    setAllCities: on => set(withAllCities(cities(), on)),
    setScopeKind: kind => set(withScopeKind(state.value, kind)),
    setArea: area => set(withArea(state.value, area)),
    toggleIndicator: id => set(withIndicator(state.value, id, !hasIndicator(id))),
    addIndicator: id => add(hasIndicator(id), () => withIndicator(state.value, id, true)),
    removeIndicator: id => set(withIndicator(state.value, id, false)),
    moveIndicator: (from, to) => {
      if (from !== to) {
        set(withIndicatorMoved(state.value, from, to));
      }
    },
    setParams: params => set({ ...state.value, params }),
    replace: set,
    reset: () => set(emptyComposition())
  };
}
