import { computed, type ComputedRef, type Ref, shallowReadonly, shallowRef } from 'vue';
import { findRegion, type Region } from '@/shared/map/region/region-catalog';

/** 计算设置：年份和监测范围，两个页签共用 */
export interface IndicatorConditions {
  readonly year: Readonly<Ref<number | null>>;
  /** 监测范围：市或区县 */
  readonly region: ComputedRef<Region | null>;
  readonly setYear: (year: number | null) => void;
  /** 不认识的代码抛错 */
  readonly setRegion: (code: string | null) => void;
  /** 回到默认条件（当年、南京市），不是清空：页面始终有可用的条件 */
  readonly reset: () => void;
}

// 默认条件沿用旧页面
const DEFAULT_REGION = '320100';

const currentYear = () => new Date().getFullYear();

export function useIndicatorConditions(): IndicatorConditions {
  const year = shallowRef<number | null>(currentYear());
  const regionCode = shallowRef<string | null>(DEFAULT_REGION);

  const setRegion = (code: string | null) => {
    if (code !== null && findRegion(code) === undefined) {
      throw new Error(`区划目录里没有 ${code}`);
    }
    regionCode.value = code;
  };

  return {
    year: shallowReadonly(year),
    region: computed(() => (regionCode.value === null ? null : (findRegion(regionCode.value) ?? null))),
    setYear: value => (year.value = value),
    setRegion,
    reset: () => {
      year.value = currentYear();
      regionCode.value = DEFAULT_REGION;
    }
  };
}
