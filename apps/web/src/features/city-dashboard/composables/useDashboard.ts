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
  const preferred = [2026, 2025].filter(year => availableYears.includes(year));
  const years = preferred.length ? preferred : availableYears.slice(0, 2);
  const state = shallowRef<FilterState>({
    years,
    cityCodes: CITIES.map(city => city.code),
    categoryId: 'resilience',
    indicatorId: CATEGORIES[0].indicators[0].id,
    activeYear: years[0] ?? null
  });
  const preferences = shallowRef<ReadonlyMap<string, ChartPreference>>(new Map());
  const category = computed(() => CATEGORIES.find(item => item.id === state.value.categoryId) ?? CATEGORIES[0]);
  const indicator = computed(() => category.value.indicators.find(item => item.id === state.value.indicatorId)
    ?? category.value.indicators[0]);
  const cityCodes = computed(() => state.value.cityCodes);
  const selectedYears = computed(() => state.value.years);
  const cities = computed(() => CITIES.filter(city => cityCodes.value.includes(city.code)));
  const comparisonYears = computed(() => selectedYears.value.toSorted((a, b) => a - b));
  const comparisons = computed(() => new Map(category.value.indicators.map(item => [
    item.id, compareIndicator(data, item, comparisonYears.value, cities.value)
  ])));
  // 六个开放年份 × 全部城市是色阶基准，不跟随用户筛选变化
  const classification = computed(() => createMapClassification(availableYears.flatMap(year =>
    CITIES.map(city => data.value(year, city.code, indicator.value.id))
  )));
  const mapValues = computed(() => Object.fromEntries(CITIES.map(city => [city.code,
    state.value.activeYear !== null && state.value.cityCodes.includes(city.code)
      ? data.value(state.value.activeYear, city.code, indicator.value.id) : null
  ])));

  function setYears(input: readonly number[]): void {
    const next = [...new Set(input)].filter(year => availableYears.includes(year)).toSorted((a, b) => b - a);
    const current = state.value.activeYear;
    state.value = {
      ...state.value,
      years: next,
      activeYear: current !== null && next.includes(current) ? current : next[0] ?? null
    };
  }

  function setCities(input: readonly string[]): void {
    state.value = { ...state.value, cityCodes: CITIES.filter(city => input.includes(city.code)).map(city => city.code) };
  }

  function toggleCity(code: string): void {
    const selected = state.value.cityCodes;
    setCities(selected.includes(code) ? selected.filter(item => item !== code) : [...selected, code]);
  }

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
    category, indicator, cities, comparisonYears, comparisons, classification, mapValues,
    setYears, setCities, toggleCity, selectCategory, selectIndicator, setActiveYear, preference, setPreference
  };
}

export type DashboardModel = ReturnType<typeof useDashboard>;
