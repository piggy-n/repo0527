import type { MapCanvasMapOptions } from '@yzt/map-vue';
import { useSessionStore } from '../auth/session-store';
import { appConfig } from '../config/app-config';
import { JIANGSU_ZOOM_RANGE } from './jiangsu';

interface MapRequest {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** 发往后端的地图请求带上 token；其他地址原样返回，登录 token 不发给天地图等第三方 */
export function withBackendToken(url: string, backendBase: string, token: string | undefined): MapRequest {
  return token && url.startsWith(backendBase) ? { url, headers: { token } } : { url };
}

/** 地图的 transformRequest：每次请求时读取当前 token，页面缓存期间重新登录后也用新的 token */
export function backendTransformRequest(url: string): MapRequest {
  const backendBase = new URL(`${appConfig.apiBaseUrl}/`, window.location.origin).href;
  return withBackendToken(url, backendBase, useSessionStore().token);
}

/** 业务地图画布的选项：缩放范围，发往后端的瓦片请求带 token */
export const JIANGSU_MAP_OPTIONS: MapCanvasMapOptions = {
  ...JIANGSU_ZOOM_RANGE,
  transformRequest: backendTransformRequest
};
