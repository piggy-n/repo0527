import type { FitBoundsOptions, StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { LatestController } from '@yzt/utils';
import { computed, type ComputedRef, getCurrentScope, onScopeDispose, shallowRef, watch } from 'vue';
import { appConfig } from '@/shared/config/app-config';
import type { Region } from '@/shared/map/region/region-catalog';
import { type RegionBoundaryLoader, sharedRegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import type { IndicatorApi } from '../api';
import type { IndicatorLeaf } from '../indicator-tree';
import { useIndicatorResultQuery } from '../queries';
import {
  type IndicatorResult,
  indicatorResultGroup,
  isRecolorable,
  pointSymbolOf,
  type PointSymbol,
  type ResultLayer,
  resultTileBase,
  sameColor
} from '../result-layers';

/** 成果面板的显示状态 */
export type IndicatorResultState =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading'; readonly indicator: IndicatorLeaf }
  | { readonly kind: 'failed'; readonly indicator: IndicatorLeaf; readonly message: string }
  | { readonly kind: 'ready'; readonly indicator: IndicatorLeaf; readonly result: IndicatorResult };

/** 面板上的一个子图层 */
export interface ResultLayerView {
  readonly layer: ResultLayer;
  readonly visible: boolean;
  /** 确认过的颜色，不含拖动取色时的预览（取色器的 modelValue 绑它，ADR 0044） */
  readonly color: string;
  /** 改过颜色（确认过的），可以恢复默认 */
  readonly customized: boolean;
  /** 旗子不能改色 */
  readonly recolorable: boolean;
}

export interface IndicatorResultOwner {
  readonly state: ComputedRef<IndicatorResultState>;
  readonly pointSymbol: ComputedRef<PointSymbol>;
  readonly layers: ComputedRef<readonly ResultLayerView[]>;
  readonly setVisible: (key: string, visible: boolean) => void;
  /** 拖动取色时的临时颜色；null 结束预览 */
  readonly previewColor: (key: string, color: string | null) => void;
  /** 确认颜色；等于默认色时算恢复默认 */
  readonly setColor: (key: string, color: string) => void;
  readonly resetColor: (key: string) => void;
  readonly retry: () => void;
  /** 绑定到成果分组 */
  readonly deriveGroup: () => StyleGroup;
}

export interface IndicatorResultOptions {
  readonly api: IndicatorApi;
  /** 展示树上选中的指标 */
  readonly indicator: () => IndicatorLeaf | null;
  /** 选中指标时的监测范围，换了范围才重新定位 */
  readonly region: () => Region | null;
  /** 定位用；组件样例不挂地图时不传 */
  readonly map?: Pick<MapContext, 'beginCameraOperation'>;
  /** 测试时注入；默认用整个应用共用的区划边界加载器 */
  readonly loader?: Pick<RegionBoundaryLoader, 'load'>;
}

// 同旧页面：最高 13.5 级；四边的留白由登记的悬浮元素决定（ADR 0029）
const FIT_OPTIONS: FitBoundsOptions = { duration: 900, maxZoom: 13.5, pitch: 0 };

/**
 * 指标成果的拥有者：选中的指标决定请求哪一个成果（查询缓存持有），这里只记子图层的显隐和临时改色。
 * 改色不持久化，换指标就清掉；显隐按指标记，换回来时还在（同旧页面）
 */
export function useIndicatorResult(options: IndicatorResultOptions): IndicatorResultOwner {
  if (!getCurrentScope()) {
    throw new Error('useIndicatorResult 只能在组件的 setup 或 effectScope 中调用');
  }
  const { api, map } = options;
  const loader = options.loader ?? sharedRegionBoundaryLoader();
  const tileBase = resultTileBase(appConfig.apiBaseUrl, window.location.origin);
  const indicator = computed(() => options.indicator());
  const query = useIndicatorResultQuery(api, () => indicator.value?.dataId ?? null);

  // 每个指标隐藏的子图层，键是指标编码；状态不可变，变化时整体替换
  const hidden = shallowRef<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  const colors = shallowRef<ReadonlyMap<string, string>>(new Map());
  const preview = shallowRef<{ readonly key: string; readonly color: string } | null>(null);

  const state = computed((): IndicatorResultState => {
    const current = indicator.value;
    if (current === null) {
      return { kind: 'none' };
    }
    const data = query.data.value;
    if (data?.id === current.dataId) {
      return { kind: 'ready', indicator: current, result: data.result };
    }
    if (query.isError.value) {
      return { kind: 'failed', indicator: current, message: query.error.value?.message ?? '' };
    }
    return { kind: 'loading', indicator: current };
  });

  const ready = computed(() => (state.value.kind === 'ready' ? state.value : null));
  const pointSymbol = computed(() => pointSymbolOf(ready.value?.result.layers ?? []));
  const hiddenKeys = computed(() => hidden.value.get(indicator.value?.code ?? '') ?? new Set<string>());
  const colorOf = (layer: ResultLayer) => {
    const current = preview.value;
    return current?.key === layer.key ? current.color : (colors.value.get(layer.key) ?? layer.color);
  };

  const layers = computed(() =>
    (ready.value?.result.layers ?? []).map(
      (layer): ResultLayerView => ({
        layer,
        visible: !hiddenKeys.value.has(layer.key),
        color: colors.value.get(layer.key) ?? layer.color,
        customized: colors.value.has(layer.key),
        recolorable: isRecolorable(layer, pointSymbol.value)
      })
    )
  );

  const layerOf = (key: string) => ready.value?.result.layers.find(layer => layer.key === key);

  const setVisible = (key: string, visible: boolean) => {
    const code = indicator.value?.code;
    if (code === undefined || hiddenKeys.value.has(key) !== visible) {
      return;
    }
    const keys = new Set(hiddenKeys.value);
    if (visible) {
      keys.delete(key);
    } else {
      keys.add(key);
    }
    hidden.value = new Map(hidden.value).set(code, keys);
  };

  // 预览等于确认过的颜色就是没有预览（ADR 0044 的取色规则）
  const previewColor = (key: string, color: string | null) => {
    const layer = layerOf(key);
    if (layer === undefined || color === null || sameColor(color, colors.value.get(key) ?? layer.color)) {
      preview.value = null;
      return;
    }
    preview.value = { key, color };
  };

  const setColor = (key: string, color: string) => {
    const layer = layerOf(key);
    if (layer === undefined) {
      return;
    }
    preview.value = null;
    const next = new Map(colors.value);
    if (sameColor(color, layer.color)) {
      next.delete(key);
    } else {
      next.set(key, color);
    }
    colors.value = next;
  };

  const resetColor = (key: string) => {
    if (preview.value?.key === key) {
      preview.value = null;
    }
    if (colors.value.has(key)) {
      const next = new Map(colors.value);
      next.delete(key);
      colors.value = next;
    }
  };

  // 换指标、取消选择：临时改色清掉
  watch(
    () => indicator.value?.code,
    () => {
      colors.value = new Map();
      preview.value = null;
    }
  );

  // 选中指标时定位到监测范围；同一个范围里换指标不再移动相机，取消选择后再选会重新定位（同旧页面）
  const focuses = new LatestController();
  onScopeDispose(() => focuses[Symbol.dispose]());
  let focused: string | null = null;
  const focus = async (region: Region, signal: AbortSignal) => {
    if (map === undefined) {
      return;
    }
    const operation = map.beginCameraOperation();
    try {
      const { bounds } = await loader.load(region);
      if (!signal.aborted) {
        operation.run(camera => camera.fitBounds(bounds, FIT_OPTIONS));
      }
    } catch {
      // 边界加载失败时不定位，成果照常显示
    }
  };
  watch(
    () => indicator.value?.code ?? null,
    code => {
      const region = options.region();
      if (code === null || region === null) {
        focused = null;
        focuses.next();
        return;
      }
      if (region.code !== focused) {
        focused = region.code;
        void focus(region, focuses.next());
      }
    }
  );

  return {
    state,
    pointSymbol,
    layers,
    setVisible,
    previewColor,
    setColor,
    resetColor,
    retry: () => {
      if (indicator.value !== null) {
        void query.refetch();
      }
    },
    deriveGroup: () => {
      const current = ready.value;
      if (current === null) {
        return indicatorResultGroup(null, tileBase);
      }
      const shown = new Map(current.result.layers.map(layer => [layer.key, colorOf(layer)]));
      return indicatorResultGroup({ result: current.result, hidden: hiddenKeys.value, colors: shown }, tileBase);
    }
  };
}
