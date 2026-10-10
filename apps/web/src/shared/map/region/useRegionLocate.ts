import type { FitBoundsOptions, StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { LatestController } from '@yzt/utils';
import { getCurrentScope, onScopeDispose, type ShallowRef, shallowReadonly, shallowRef } from 'vue';
import { findRegion, type Region } from './region-catalog';
import { type RegionBoundary, type RegionBoundaryLoader, sharedRegionBoundaryLoader } from './region-geometry';
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
  /** 默认用整个应用共用的加载器（和位置点共用），同一个文件只下载、解析一次；测试时注入 */
  readonly loader?: Pick<RegionBoundaryLoader, 'load'>;
}

// 与旧项目一致；四边的留白由登记的悬浮元素决定（ADR 0029），俯角归零（ADR 0036 第 3 条）
const FIT_OPTIONS: FitBoundsOptions = { duration: 1100, maxZoom: 14.5, pitch: 0 };

const NONE: RegionLocateState = Object.freeze({ selected: null, boundary: Object.freeze({ kind: 'none' }) });

/**
 * 面板上点击一个区划后要选择的代码（同旧项目）：再点已选中的区县回到所在的市；
 * 选中市或它的区县时这个市都算选中，再点它回到全省
 */
export function nextRegionSelection(selected: Region | null, clicked: Region): string | null {
  if (clicked.level === 'city') {
    return selected?.cityCode === clicked.code ? null : clicked.code;
  }
  return selected?.code === clicked.code ? clicked.cityCode : clicked.code;
}

/** 创建区划定位的拥有者，在 provideMap 所在组件的 setup 中调用；作用域销毁后晚到的结果不写入、不定位 */
export function useRegionLocate(
  map: Pick<MapContext, 'beginCameraOperation'>,
  options: RegionLocateOptions
): RegionLocate {
  if (!getCurrentScope()) {
    throw new Error('useRegionLocate 只能在组件的 setup 或 effectScope 中调用');
  }
  const loader = options.loader ?? sharedRegionBoundaryLoader();
  const state = shallowRef<RegionLocateState>(NONE);
  // 每次选择一个信号：换选、回到全省、作用域销毁时中止，晚到的结果不写入状态
  const selections = new LatestController();

  const locate = async (region: Region, signal: AbortSignal) => {
    // 选择区划是一次相机操作，之前没完成的定位作废；之后又有了新的操作（拖动、缩放、默认视角、坐标定位）时，
    // 边界到位后只高亮，不覆盖当前视角（ADR 0038）
    const operation = map.beginCameraOperation();
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
    // 视图没就绪时等到就绪再定位；有了新的相机操作时不定位，高亮照常显示（ADR 0039）
    operation.run(camera => camera.fitBounds(boundary.bounds, FIT_OPTIONS));
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
    const signal = selections.next();
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
      void locate(selected, selections.next());
    }
  };

  onScopeDispose(() => selections[Symbol.dispose]());

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
