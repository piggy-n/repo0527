import type { ApiError } from './errors';

/** 由 app 在启动时注入的回调，shared/http 因此不依赖路由、UI 和鉴权 */
export interface HttpHooks {
  /** 每个请求附加的请求头，例如登录 token */
  getHeaders?: () => Record<string, string>;
  /** 未登录或登录过期；不受 silent 影响，也不再触发 onError */
  onUnauthorized?: (error: ApiError) => void;
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
