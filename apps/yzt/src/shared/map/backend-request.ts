import type { MapCanvasMapOptions } from '@yzt/map-vue';
import { z } from 'zod';
import { useSessionStore } from '../auth/session-store';
import { appConfig } from '../config/app-config';
import { getHttpHooks } from '../http/configure';
import { ApiError } from '../http/errors';
import { UNAUTHORIZED_MESSAGE } from '../http/messages';
import { JIANGSU_ZOOM_RANGE } from './jiangsu';

interface MapRequest {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

// MapLibre 的瓦片错误带状态码和地址；shared 不能导入 maplibre-gl，只校验用到的字段
const unauthorizedRequestSchema = z.object({ status: z.literal(401), url: z.string() });

// 瓦片的错误带不回请求头：记下最后发给后端的 token，交给 onUnauthorized 分辨旧会话的请求
let lastSentToken: string | undefined;

function backendBase(): string {
  return new URL(`${appConfig.apiBaseUrl}/`, window.location.origin).href;
}

/** 地图的 transformRequest：发往后端的请求带上当前 token，其他地址原样返回，登录 token 不发给天地图等第三方 */
export function backendTransformRequest(url: string): MapRequest {
  if (!url.startsWith(backendBase())) {
    return { url };
  }
  lastSentToken = useSessionStore().token;
  return lastSentToken ? { url, headers: { token: lastSentToken } } : { url };
}

/** 地图运行中的错误：带 token 发往后端的瓦片返回 401 时，和接口的 401 走同一个流程，其余打印到控制台 */
export function reportMapError(error: unknown): void {
  const unauthorized = unauthorizedRequestSchema.safeParse(error);
  if (unauthorized.success && lastSentToken && unauthorized.data.url.startsWith(backendBase())) {
    const { url } = unauthorized.data;
    const apiError = new ApiError({ kind: 'unauthorized', message: UNAUTHORIZED_MESSAGE, status: 401, url });
    getHttpHooks().onUnauthorized?.(apiError, { headers: { token: lastSentToken } });
    return;
  }
  console.error('[map]', error);
}

/** 业务地图画布的选项：缩放范围，发往后端的瓦片请求带 token，静态底图的地名用页面的字体在本地画（ADR 0133） */
export const JIANGSU_MAP_OPTIONS: MapCanvasMapOptions = {
  ...JIANGSU_ZOOM_RANGE,
  transformRequest: backendTransformRequest,
  localIdeographFontFamily: '"Alibaba PuHuiTi", "Microsoft YaHei", sans-serif'
};
