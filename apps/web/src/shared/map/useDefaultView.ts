import type { MapContext } from '@yzt/map-vue';
import { getCurrentScope, watch } from 'vue';
import { JIANGSU_BOUNDS } from './jiangsu';

/** 回到默认视角的动画时长（毫秒），与旧项目一致 */
const DEFAULT_VIEW_DURATION = 500;

export interface DefaultView {
  /** 按江苏的范围适配，避开悬浮元素，旋转归零；视图没有就绪时什么也不做 */
  readonly goToDefaultView: () => void;
}

/**
 * 默认视角（ADR 0033）：本次进入页面后视图第一次就绪时不带动画地按江苏的范围适配一次（首次失败、重试成功后同样补做），
 * 之后不再覆盖用户调整过的视角。只在 provideMap 所在组件的 setup 中调用一次，传入页面句柄；
 * 工具栏等需要回到默认视角的组件通过 props 拿到 goToDefaultView，不要自己再调用，否则下一次就绪时会重置用户的视角
 */
export function useDefaultView(map: Pick<MapContext, 'view' | 'viewState'>): DefaultView {
  if (!getCurrentScope()) {
    throw new Error('useDefaultView 只能在组件的 setup 或 effectScope 中调用');
  }
  if (map.view.value) {
    throw new Error('useDefaultView 要在画布创建视图之前调用（provideMap 所在组件的 setup），其他组件通过 props 拿到 goToDefaultView');
  }

  // 定位只能由就绪的视图发起（ADR 0024）；fitBounds 不传 padding 时自动避开登记过的悬浮元素（ADR 0029）
  const fit = (duration: number): boolean => {
    const view = map.view.value;
    if (map.viewState.value !== 'ready' || !view) {
      return false;
    }
    view.fitBounds(JIANGSU_BOUNDS, { duration });
    return true;
  };

  // 作用域销毁（页面卸载）时侦听器随之停止
  const stopInitialFit = watch(map.viewState, () => {
    if (fit(0)) {
      stopInitialFit();
    }
  });

  return { goToDefaultView: () => void fit(DEFAULT_VIEW_DURATION) };
}
