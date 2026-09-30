import type { ApiError } from './errors';

/** 出错的请求发出时的信息 */
export interface SentRequest {
  /** 发出时 getHeaders 返回的请求头 */
  headers: Record<string, string>;
}

/** 由 app 在启动时注入的回调，shared/http 因此不依赖路由、UI 和鉴权 */
export interface HttpHooks {
  /** 每个请求附加的请求头，例如登录 token */
  getHeaders?: () => Record<string, string>;
  /** 未登录或登录过期；不受 silent 影响，也不再触发 onError。请求往返期间会话可能已经更换，用 request 判断是否是旧会话的请求 */
  onUnauthorized?: (error: ApiError, request: SentRequest) => void;
  /** 需要提示用户的错误；取消的请求和 silent 请求不会触发 */
  onError?: (error: ApiError) => void;
}

let hooks: HttpHooks = {};

/** 替换全部回调；测试结束时传入空对象复原 */
export function configureHttp(next: HttpHooks): void {
  hooks = next;
}

export function getHttpHooks(): HttpHooks {
  return hooks;
}
