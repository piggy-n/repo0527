// 文案沿用旧项目 libs/http-service.js
const statusMessages: Partial<Record<number, string>> = {
  400: '错误请求',
  401: '登录状态已过期，请重新登录',
  403: '拒绝访问',
  404: '请求错误，未找到该资源',
  405: '请求方法未允许',
  408: '请求超时',
  500: '服务端出错',
  501: '网络未实现',
  503: '服务不可用',
  504: '网络超时'
};

export const DEFAULT_ERROR_MESSAGE = '后台服务异常，请联系管理员！';
export const NETWORK_ERROR_MESSAGE = '网络出现问题，请稍后再试';
export const TIMEOUT_ERROR_MESSAGE = '请求超时，请稍后再试';
export const INVALID_RESPONSE_MESSAGE = '服务返回的数据格式不正确';

/** 按状态码或业务码生成提示：401 统一提示登录过期，其余优先使用后端返回的 msg */
export function resolveErrorMessage(code: number, backendMessage?: string): string {
  if (code === 401) {
    return statusMessages[401] ?? DEFAULT_ERROR_MESSAGE;
  }
  // 后端可能返回空字符串，所以用 || 而不是 ??
  return backendMessage || statusMessages[code] || DEFAULT_ERROR_MESSAGE;
}
