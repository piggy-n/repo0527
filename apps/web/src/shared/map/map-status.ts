import type { MapViewFailure } from '@yzt/map-core';
import type { MapViewState } from '@yzt/map-vue';

/** 地图状态要显示的内容（ADR 0030）：界面只负责显示，文案和能否重试都在这里决定 */
export type MapStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  /** 引擎失败不能自动恢复，提供重试 */
  | { readonly kind: 'engine-failed'; readonly title: string; readonly detail: string; readonly technical?: string }
  /** 样式失败在样式出现新版本时自动恢复，不提供重试 */
  | { readonly kind: 'style-failed'; readonly title: string; readonly detail: string; readonly technical: string };

const ENGINE_TITLE = '地图无法显示';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeFailure(failure: MapViewFailure | null): MapStatus {
  if (failure?.kind === 'style') {
    return {
      kind: 'style-failed',
      title: '地图样式加载失败',
      detail: '部分图层的样式有误，地图暂时显示不了。改动图层后会自动重新加载。',
      technical: messageOf(failure.error)
    };
  }
  if (failure?.cause === 'webgl-unavailable') {
    return {
      kind: 'engine-failed',
      title: ENGINE_TITLE,
      detail: '浏览器不支持 WebGL2，或者显卡加速不可用。请使用新版 Chrome、Edge 或 Firefox，并确认已开启硬件加速。'
    };
  }
  // 原因未知，或者处于 failed 却没有原因（不应出现）：按引擎失败处理，允许重试
  return {
    kind: 'engine-failed',
    title: ENGINE_TITLE,
    detail: '地图引擎出错，可以重试；仍然失败时请刷新页面。',
    ...(failure ? { technical: messageOf(failure.error) } : {})
  };
}

/** 由视图状态和失败原因推导要显示的内容；没有视图、就绪、暂停、已释放时不显示 */
export function describeMapStatus(viewState: MapViewState, failure: MapViewFailure | null): MapStatus {
  if (viewState === 'initializing') {
    return { kind: 'loading' };
  }
  if (viewState === 'failed') {
    return describeFailure(failure);
  }
  return { kind: 'none' };
}
