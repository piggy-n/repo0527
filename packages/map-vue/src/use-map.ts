import { getCurrentScope, inject, onScopeDispose, type Ref } from 'vue';
import { INTERNAL_MAP_CONTEXT, type MapContext, type MapContextState } from './context';
import type { OverlayEdge } from './overlay';

/** 内部使用：拿到完整的上下文；找不到 provideMap 时抛错 */
export function injectMapState(caller: string): MapContextState {
  const state = inject(INTERNAL_MAP_CONTEXT, null);
  if (!state) {
    throw new Error(`${caller} 必须放在调用了 provideMap 的组件里面`);
  }
  return state;
}

/** 子孙组件读取地图状态：视图的受限入口、视图状态、等待就绪、订阅相机；不能写样式，也不能直接写相机 */
export function useMap(): MapContext {
  return injectMapState('useMap').context;
}

/**
 * 悬浮元素登记自己贴着画布的哪一边，定位时避开它（ADR 0029）；只登记贴边、会挡住定位的元素。
 * 元素为空、尺寸为 0、和画布不相交时不算；作用域销毁时注销
 */
export function useMapOverlay(target: Readonly<Ref<HTMLElement | null | undefined>>, edge: OverlayEdge): void {
  const state = injectMapState('useMapOverlay');
  if (!getCurrentScope()) {
    throw new Error('useMapOverlay 只能在组件的 setup 或 effectScope 中调用');
  }
  onScopeDispose(state.registerOverlay(target, edge));
}
