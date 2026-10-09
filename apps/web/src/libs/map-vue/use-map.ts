import { inject } from 'vue';
import { INTERNAL_MAP_CONTEXT, type MapContext, type MapContextState } from './context';

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
