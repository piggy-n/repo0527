import type { MapContext, MapViewport } from '@yzt/map-vue';
import { getCurrentScope, watch } from 'vue';
import { JIANGSU_BOUNDS } from './jiangsu';

/** 回到默认视角的动画时长（毫秒），与旧项目一致 */
const DEFAULT_VIEW_DURATION = 500;

// fitBounds 不传 padding 时自动避开登记过的悬浮元素（ADR 0029）；默认视角是平视的，fitBounds 只把旋转归零，俯角要明确传入
function fitJiangsu(view: MapViewport, duration: number): void {
  view.fitBounds(JIANGSU_BOUNDS, { duration, pitch: 0 });
}

export interface DefaultView {
  /** 按江苏的范围适配，避开悬浮元素，旋转和俯角归零；是一次相机操作，视图还没就绪时等到就绪再定位（ADR 0038） */
  readonly goToDefaultView: () => void;
}

/**
 * 默认视角（ADR 0033）：本次进入页面后视图第一次就绪时不带动画地按江苏的范围适配一次（首次失败、重试成功后同样补做），
 * 之后不再覆盖用户调整过的视角；初始适配不是一次相机操作，就绪之前用户已经开始了操作（选区划、坐标定位等）时让给它（ADR 0038）。
 * 只在 provideMap 所在组件的 setup 中调用一次，传入页面句柄；
 * 工具栏等需要回到默认视角的组件通过 props 拿到 goToDefaultView，不要自己再调用，否则下一次就绪时会重置用户的视角
 */
export function useDefaultView(
  map: Pick<MapContext, 'view' | 'viewState' | 'currentCameraOperation' | 'runCameraOperation'>
): DefaultView {
  if (!getCurrentScope()) {
    throw new Error('useDefaultView 只能在组件的 setup 或 effectScope 中调用');
  }
  if (map.view.value) {
    throw new Error('useDefaultView 要在画布创建视图之前调用（provideMap 所在组件的 setup），其他组件通过 props 拿到 goToDefaultView');
  }

  // 进入页面时的相机操作：之后用户开始了新的操作，它就中止
  const initial = map.currentCameraOperation();
  // 定位只能由就绪的视图发起（ADR 0024）；作用域销毁（页面卸载）时侦听器随之停止
  const stopInitialFit = watch(map.viewState, state => {
    const view = map.view.value;
    if (initial.aborted) {
      stopInitialFit();
    } else if (state === 'ready' && view) {
      fitJiangsu(view, 0);
      stopInitialFit();
    }
  });

  return { goToDefaultView: () => map.runCameraOperation(view => fitJiangsu(view, DEFAULT_VIEW_DURATION)) };
}
