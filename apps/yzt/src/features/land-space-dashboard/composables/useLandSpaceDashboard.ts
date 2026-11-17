import { computed, shallowRef, type ComputedRef } from 'vue';
import { compareIndicator } from '@/shared/dashboard/calculations';
import { DASHBOARD_CITIES } from '@/shared/dashboard/cities';
import { createMapClassification } from '@/shared/dashboard/map-classification';
import type { MapValues } from '@/shared/dashboard/map/types';
import type { ChartPreference, ChartType, Comparison, IndicatorMeta } from '@/shared/dashboard/model';
import type { LandSpaceCardId } from '../cards';
import {
  LAND_SPACE_DATA,
  LAND_SPACE_DOMAINS,
  partValueId,
  type LandSpaceDomain,
  type LandSpaceDomainId
} from '../data/land-space-data';

/** 没有指数值的二级（体育活动便利性等）在地图和二级卡上的说明 */
export const NO_INDEX_VALUES = '原报告未列指数值';

/** 分项名接在三级名称后面的分隔，卡片详情、下载、提示的标题都用它 */
export const PART_SEPARATOR = ' · ';

interface LandSpaceState {
  readonly years: readonly number[];
  readonly cityCodes: readonly string[];
  readonly domainId: LandSpaceDomainId;
  readonly subIndexId: string;
  readonly indicatorId: string;
  /** 三级的分项；null 是「综合」（不带分项的值） */
  readonly partId: string | null;
  readonly activeYear: number;
}

/** 图表偏好按卡位保存：一级、三级只有柱和折线，二级多一个雷达 */
export interface LandSpacePreferences {
  readonly domain: ChartPreference;
  readonly sub: ChartPreference<ChartType>;
  readonly indicator: ChartPreference;
}

const DEFAULT_PREFERENCES: LandSpacePreferences = {
  domain: { type: 'bar', showAverage: true, legend: {} },
  sub: { type: 'radar', showAverage: true, legend: {} },
  indicator: { type: 'bar', showAverage: true, legend: {} }
};

// 选中一级时连带选中的二级、三级
function domainDefaults(domain: LandSpaceDomain) {
  const sub = domain.subIndices[0];
  return { domainId: domain.id, subIndexId: sub.id, indicatorId: sub.indicators[0].id, partId: null };
}

/** 综合分析驾驶舱的状态拥有者：筛选、一二三级的选择和三张卡的偏好；组件只调用这里的操作 */
export function useLandSpaceDashboard() {
  const availableYears = LAND_SPACE_DATA.years;
  const state = shallowRef<LandSpaceState>({
    years: availableYears,
    cityCodes: DASHBOARD_CITIES.map(city => city.code),
    ...domainDefaults(LAND_SPACE_DOMAINS[0]),
    activeYear: availableYears[0]
  });
  const preferences = shallowRef<LandSpacePreferences>(DEFAULT_PREFERENCES);
  const domain = computed(
    () => LAND_SPACE_DOMAINS.find(item => item.id === state.value.domainId) ?? LAND_SPACE_DOMAINS[0]
  );
  const subIndex = computed(() => {
    const { subIndices } = domain.value;
    return subIndices.find(item => item.id === state.value.subIndexId) ?? subIndices[0];
  });
  const indicator = computed(() => {
    const { indicators } = subIndex.value;
    return indicators.find(item => item.id === state.value.indicatorId) ?? indicators[0];
  });
  const parts = computed(() => indicator.value.parts);
  const part = computed(() => parts.value.find(item => item.id === state.value.partId) ?? null);
  // 下面几项值不变时不通知依赖方：切换三级、分项不让地图重算
  const cityCodes = computed(() => state.value.cityCodes);
  const years = computed(() => state.value.years);
  const activeYear = computed(() => state.value.activeYear);
  const mapIndexId = computed(() => subIndex.value.indexId);
  const cities = computed(() => DASHBOARD_CITIES.filter(city => cityCodes.value.includes(city.code)));

  // 一级、二级是指数，名称用分类名；三级有分项时名称后接分项名，值的 id 是 partValueId
  const metas: Readonly<Record<LandSpaceCardId, ComputedRef<IndicatorMeta>>> = {
    domain: computed(() => {
      const { indexId, name, unit, precision } = domain.value;
      return { id: indexId, name, unit, precision };
    }),
    sub: computed(() => {
      const { indexId, name, unit, precision } = subIndex.value;
      return { id: indexId, name, unit, precision };
    }),
    indicator: computed(() => {
      const { id, name, unit, precision } = indicator.value;
      const selected = part.value;
      return {
        id: partValueId(id, selected?.id ?? null),
        name: selected ? `${name}${PART_SEPARATOR}${selected.name}` : name,
        unit,
        precision
      };
    })
  };

  function compare(meta: IndicatorMeta): Comparison[] {
    return compareIndicator(LAND_SPACE_DATA, meta, years.value, cities.value);
  }

  const comparisons: Readonly<Record<LandSpaceCardId, ComputedRef<Comparison[]>>> = {
    domain: computed(() => compare(metas.domain.value)),
    sub: computed(() => compare(metas.sub.value)),
    indicator: computed(() => compare(metas.indicator.value))
  };

  /** 当前二级没有指数值时的说明，地图和二级卡共用 */
  const notice = computed(() => (subIndex.value.hasValues ? undefined : NO_INDEX_VALUES));

  // 色阶以 13 个市 2025 年的二级指数为基准，不随城市筛选变化
  const classification = computed(() => {
    const id = mapIndexId.value;
    return createMapClassification(
      availableYears.flatMap(year => DASHBOARD_CITIES.map(city => LAND_SPACE_DATA.value(year, city.code, id)))
    );
  });

  // 地图只显示所选城市的二级指数，其余城市为空
  const mapValues = computed<MapValues>(() => {
    const id = mapIndexId.value;
    const year = activeYear.value;
    const selected = cityCodes.value;
    return Object.fromEntries(
      DASHBOARD_CITIES.map(city => [
        city.code,
        selected.includes(city.code) ? LAND_SPACE_DATA.value(year, city.code, id) : null
      ])
    );
  });

  /** 只有 2025 一年：空集合和不在数据里的年份都忽略，年份不会被清空 */
  function setYears(input: readonly number[]): void {
    const next = availableYears.filter(year => input.includes(year));
    if (next.length) {
      state.value = { ...state.value, years: next };
    }
  }

  function setActiveYear(year: number): void {
    if (state.value.years.includes(year)) {
      state.value = { ...state.value, activeYear: year };
    }
  }

  function setCities(input: readonly string[]): void {
    state.value = {
      ...state.value,
      cityCodes: DASHBOARD_CITIES.filter(city => input.includes(city.code)).map(city => city.code)
    };
  }

  function toggleCity(code: string): void {
    const selected = state.value.cityCodes;
    setCities(selected.includes(code) ? selected.filter(item => item !== code) : [...selected, code]);
  }

  /** 换一级时选中它的第一个二级、第一个三级和「综合」；点当前一级不变 */
  function selectDomain(id: string): void {
    const next = LAND_SPACE_DOMAINS.find(item => item.id === id);
    if (next && next.id !== state.value.domainId) {
      state.value = { ...state.value, ...domainDefaults(next) };
    }
  }

  /** 换二级时选中它的第一个三级和「综合」 */
  function selectSubIndex(id: string): void {
    const next = domain.value.subIndices.find(item => item.id === id);
    if (next && next.id !== state.value.subIndexId) {
      state.value = { ...state.value, subIndexId: next.id, indicatorId: next.indicators[0].id, partId: null };
    }
  }

  /** 换三级时回到「综合」 */
  function selectIndicator(id: string): void {
    if (id !== state.value.indicatorId && subIndex.value.indicators.some(item => item.id === id)) {
      state.value = { ...state.value, indicatorId: id, partId: null };
    }
  }

  /** null 是「综合」 */
  function selectPart(id: string | null): void {
    if (id === null || parts.value.some(item => item.id === id)) {
      state.value = { ...state.value, partId: id };
    }
  }

  /** 偏好跟着卡位走，切换指标时不清空 */
  function setPreference<K extends LandSpaceCardId>(card: K, patch: Partial<LandSpacePreferences[K]>): void {
    const current = preferences.value;
    preferences.value = { ...current, [card]: { ...current[card], ...patch } };
  }

  return {
    availableYears,
    state: computed(() => state.value),
    domain,
    subIndex,
    indicator,
    parts,
    part,
    cities,
    metas,
    comparisons,
    notice,
    classification,
    mapValues,
    preferences: computed(() => preferences.value),
    setYears,
    setActiveYear,
    setCities,
    toggleCity,
    selectDomain,
    selectSubIndex,
    selectIndicator,
    selectPart,
    setPreference
  };
}

export type LandSpaceModel = ReturnType<typeof useLandSpaceDashboard>;
