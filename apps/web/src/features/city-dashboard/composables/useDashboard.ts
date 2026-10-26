import { computed, shallowRef } from 'vue';
import { CATEGORIES, CITIES, DASHBOARD_YEARS } from '../catalog';
import { compareIndicator } from '../calculations';
import { createMapClassification } from '../map-classification';
import { getDefaultChartType } from '../charts/presentation';
import type { CategoryId, ChartPreference, DashboardData, Indicator } from '../model';

interface FilterState {
  readonly years: readonly number[];
  readonly cityCodes: readonly string[];
  readonly categoryId: CategoryId;
  readonly indicatorId: string;
  readonly activeYear: number | null;
}

/** 单页状态拥有者：筛选与图表偏好通过操作更新，组件不直接改内部快照 */
export function useDashboard(data: DashboardData) {
  const availableYears = DASHBOARD_YEARS.filter(year => data.years.includes(year));
  const preferredYears = [2026, 2025].filter(year => availableYears.includes(year));
  const years = preferredYears.length ? preferredYears : availableYears.slice(0, 2);
  const state = shallowRef<FilterState>({
    years,
    cityCodes: CITIES.map(city => city.code),
    categoryId: 'resilience',
    indicatorId: CATEGORIES[0].indicators[0].id,
    activeYear: years[0] ?? null
  });
  const preferences = shallowRef<ReadonlyMap<string, ChartPreference>>(new Map());
  const category = computed(() => CATEGORIES.find(item => item.id === state.value.categoryId) ?? CATEGORIES[0]);
  const indicator = computed(() => {
    const { indicators } = category.value;
    return indicators.find(item => item.id === state.value.indicatorId) ?? indicators[0];
  });
  const cityCodes = computed(() => state.value.cityCodes);
  const selectedYears = computed(() => state.value.years);
  const cities = computed(() => CITIES.filter(city => cityCodes.value.includes(city.code)));
  const comparisonYears = computed(() => selectedYears.value.toSorted((a, b) => a - b));
  const comparisons = computed(() => {
    const entries = category.value.indicators.map(
      item => [item.id, compareIndicator(data, item, comparisonYears.value, cities.value)] as const
    );
    return new Map(entries);
  });
  // 六个开放年份 × 全部城市是色阶基准，不跟随用户筛选变化
  const classification = computed(() => {
    const { id } = indicator.value;
    return createMapClassification(availableYears.flatMap(year => CITIES.map(city => data.value(year, city.code, id))));
  });
  // 地图只显示所选城市在当前年份的数值，其余城市为空
  const mapValues = computed(() => {
    const { activeYear, cityCodes: selected } = state.value;
    const { id } = indicator.value;
    return Object.fromEntries(
      CITIES.map(city => {
        const shown = activeYear !== null && selected.includes(city.code);
        return [city.code, shown ? data.value(activeYear, city.code, id) : null];
      })
    );
  });

  /** 比较年改变时优先保留当前地图年份，已移除则回到最新所选年 */
  function setYears(input: readonly number[]): void {
    const nextYears = [...new Set(input)].filter(year => availableYears.includes(year)).toSorted((a, b) => b - a);
    const activeYear = state.value.activeYear;
    state.value = {
      ...state.value,
      years: nextYears,
      activeYear: activeYear !== null && nextYears.includes(activeYear) ? activeYear : nextYears[0] ?? null
    };
  }

  function setCities(input: readonly string[]): void {
    state.value = {
      ...state.value,
      cityCodes: CITIES.filter(city => input.includes(city.code)).map(city => city.code)
    };
  }

  function toggleCity(code: string): void {
    const selected = state.value.cityCodes;
    setCities(selected.includes(code) ? selected.filter(item => item !== code) : [...selected, code]);
  }

  /** 分类切换回到首个指标，并清理上一分类的临时图表偏好 */
  function selectCategory(id: CategoryId): void {
    const next = CATEGORIES.find(item => item.id === id);
    if (!next?.indicators.length) {
      return;
    }
    const changed = state.value.categoryId !== id;
    state.value = { ...state.value, categoryId: id, indicatorId: next.indicators[0].id };
    if (changed) {
      preferences.value = new Map();
    }
  }

  function selectIndicator(id: string): void {
    if (category.value.indicators.some(item => item.id === id)) {
      state.value = { ...state.value, indicatorId: id };
    }
  }

  function setActiveYear(year: number): void {
    if (state.value.years.includes(year)) {
      state.value = { ...state.value, activeYear: year };
    }
  }

  function preference(item: Indicator): ChartPreference {
    return preferences.value.get(item.id) ?? { type: getDefaultChartType(item), showAverage: true, legend: {} };
  }

  function setPreference(item: Indicator, patch: Partial<ChartPreference>): void {
    if (category.value.indicators.some(current => current.id === item.id)) {
      preferences.value = new Map(preferences.value).set(item.id, { ...preference(item), ...patch });
    }
  }

  return {
    availableYears,
    state: computed(() => state.value),
    category,
    indicator,
    cities,
    comparisonYears,
    comparisons,
    classification,
    mapValues,
    setYears,
    setCities,
    toggleCity,
    selectCategory,
    selectIndicator,
    setActiveYear,
    preference,
    setPreference
  };
}

export type DashboardModel = ReturnType<typeof useDashboard>;
