import type { FitBoundsOptions, StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { getCurrentScope, onScopeDispose, type ShallowRef, shallowReadonly, shallowRef } from 'vue';
import { findRegion, type Region } from './region-catalog';
import { createRegionBoundaryLoader, type RegionBoundary, type RegionBoundaryLoader } from './region-geometry';
import { regionGroup } from './region-style';

/** 选中区划的边界：全省没有边界；加载失败时记下原因，可以重试 */
export type RegionBoundaryStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly boundary: RegionBoundary }
  | { readonly kind: 'failed'; readonly error: unknown };

export interface RegionLocateState {
  /** 选中的市或区县；null 是全省 */
  readonly selected: Region | null;
  readonly boundary: RegionBoundaryStatus;
}

/** 区划定位的拥有者（ADR 0036）：页面绑定 region 分组，面板通过 props 拿到它 */
export interface RegionLocate {
  readonly state: Readonly<ShallowRef<RegionLocateState>>;
  /** 选择市或区县并定位；null 回到全省。选的就是当前的区划时什么也不做，不认识的代码抛错 */
  readonly select: (code: string | null) => void;
  /** 边界加载失败后重新加载；其他时候什么也不做 */
  readonly retry: () => void;
  /** 绑定到 region 分组 */
  readonly deriveGroup: () => StyleGroup;
}

export interface RegionLocateOptions {
  /** 从市或区县回到全省时调用，现状底图传入 useDefaultView 的 goToDefaultView */
  readonly goToDefaultView: () => void;
  /** 默认用共享的加载器，同一个文件在整个应用里只下载、解析一次；测试时注入 */
  readonly loader?: RegionBoundaryLoader;
}

// 与旧项目一致；四边的留白由登记的悬浮元素决定（ADR 0029），俯角归零（ADR 0036 第 3 条）
const FIT_OPTIONS: FitBoundsOptions = { duration: 1100, maxZoom: 14.5, pitch: 0 };

const NONE: RegionLocateState = Object.freeze({ selected: null, boundary: Object.freeze({ kind: 'none' }) });

let sharedLoader: RegionBoundaryLoader | undefined;

/** 面板上点击一个区划后要选择的代码：再点已选中的市回到全省，再点已选中的区县回到所在的市（同旧项目） */
export function nextRegionSelection(selected: Region | null, clicked: Region): string | null {
  if (selected?.code !== clicked.code) {
    return clicked.code;
  }
  return clicked.level === 'city' ? null : clicked.cityCode;
}

/** 创建区划定位的拥有者，在 provideMap 所在组件的 setup 中调用；作用域销毁时取消进行中的加载和定位 */
export function useRegionLocate(
  map: Pick<MapContext, 'view' | 'whenReady'>,
  options: RegionLocateOptions
): RegionLocate {
  if (!getCurrentScope()) {
    throw new Error('useRegionLocate 只能在组件的 setup 或 effectScope 中调用');
  }
  const loader = options.loader ?? (sharedLoader ??= createRegionBoundaryLoader());
  const state = shallowRef<RegionLocateState>(NONE);
  // 每次选择一个控制器：换选、回到全省、作用域销毁时中止，晚到的结果不写入状态
  let current = new AbortController();

  const restart = () => {
    current.abort();
    current = new AbortController();
    return current.signal;
  };

  const locate = async (region: Region, signal: AbortSignal) => {
    state.value = { selected: region, boundary: { kind: 'loading' } };
    let boundary: RegionBoundary;
    try {
      boundary = await loader.load(region);
    } catch (error) {
      if (!signal.aborted) {
        state.value = { selected: region, boundary: { kind: 'failed', error } };
      }
      return;
    }
    if (signal.aborted) {
      return;
    }
    state.value = { selected: region, boundary: { kind: 'ready', boundary } };
    // 视图被替换、失败或选择已经过期时不定位，高亮照常显示
    try {
      await map.whenReady(signal);
    } catch {
      return;
    }
    map.view.value?.fitBounds(boundary.bounds, FIT_OPTIONS);
  };

  const select = (code: string | null) => {
    const region = code === null ? null : findRegion(code);
    if (region === undefined) {
      throw new Error(`区划目录里没有 ${code}`);
    }
    const previous = state.value.selected;
    if (region?.code === previous?.code) {
      return;
    }
    const signal = restart();
    if (region) {
      void locate(region, signal);
      return;
    }
    state.value = NONE;
    options.goToDefaultView();
  };

  const retry = () => {
    const { selected, boundary } = state.value;
    if (selected && boundary.kind === 'failed') {
      void locate(selected, restart());
    }
  };

  onScopeDispose(() => current.abort());

  return {
    state: shallowReadonly(state),
    select,
    retry,
    deriveGroup: () => {
      const { boundary } = state.value;
      return regionGroup(boundary.kind === 'ready' ? boundary.boundary : null);
    }
  };
}
