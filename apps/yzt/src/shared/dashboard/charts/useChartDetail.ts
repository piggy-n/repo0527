import { computed, ref, shallowRef, watch, type WatchSource } from 'vue';
import { DASHBOARD_CITIES } from '../cities';
import type { City } from '../model';

export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

/** 详情图的初始尺寸，弹窗量到图表区之前用它排标签 */
export const DEFAULT_DETAIL_SIZE: ChartSize = { width: 780, height: 440 };

export interface ChartDetailOptions<T> {
  /** 打开时复制这张卡的图例，之后详情里的图例单独维护 */
  legend: (target: T) => Readonly<Record<string, boolean>>;
  /** 所选城市，用来说明聚焦的城市在不在筛选里 */
  cities: () => readonly City[];
  /** 变化时清掉详情里悬停的城市，如筛选状态 */
  reset?: WatchSource<unknown>;
  /** 变化时关闭详情，如原驾驶舱切换指标类型 */
  closeOn?: WatchSource<unknown>;
}

/** 放大详情的状态：打开的目标、聚焦和悬停的城市、独立的图例和图表区尺寸；详情的图表配置由调用方按它们计算 */
export function useChartDetail<T>(options: ChartDetailOptions<T>) {
  // 关闭后保留目标，弹窗淡出时内容不变
  const current = shallowRef<{ readonly target: T; readonly cityCode: string | null } | null>(null);
  const visible = ref(false);
  const legend = shallowRef<Readonly<Record<string, boolean>>>({});
  const hoverCode = ref<string | null>(null);
  const size = shallowRef<ChartSize>(DEFAULT_DETAIL_SIZE);
  const cityCode = computed(() => current.value?.cityCode ?? null);
  const focusedCity = computed(() => DASHBOARD_CITIES.find(city => city.code === cityCode.value));
  const hoveredCity = computed(() => DASHBOARD_CITIES.find(city => city.code === hoverCode.value));
  // 聚焦的城市不在当前的城市筛选里时也说明
  const focusText = computed(() => {
    const city = focusedCity.value;
    if (!city) {
      return '';
    }
    const included = options.cities().some(item => item.code === city.code);
    return included ? `${city.name} · 当前查看城市` : `${city.name} · 未纳入当前城市筛选`;
  });

  function open(target: T, focusedCityCode: string | null = null): void {
    current.value = { target, cityCode: focusedCityCode };
    legend.value = { ...options.legend(target) };
    hoverCode.value = null;
    visible.value = true;
  }

  function close(): void {
    visible.value = false;
    hoverCode.value = null;
  }

  function setLegend(selected: Readonly<Record<string, boolean>>): void {
    legend.value = selected;
  }

  function setHover(code: string | null): void {
    hoverCode.value = code;
  }

  function setSize(next: ChartSize): void {
    size.value = next;
  }

  if (options.reset) {
    watch(options.reset, () => {
      hoverCode.value = null;
    });
  }
  if (options.closeOn) {
    watch(options.closeOn, close);
  }

  return {
    visible: computed(() => visible.value),
    target: computed(() => current.value?.target ?? null),
    cityCode,
    focusedCity,
    focusText,
    hoveredCity,
    legend: computed(() => legend.value),
    size: computed(() => size.value),
    open,
    close,
    setLegend,
    setHover,
    setSize
  };
}
