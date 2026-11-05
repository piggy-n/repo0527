/** 请求失败的类型 */
export type ApiErrorKind =
  // HTTP 成功，但响应中的 code 不是 200
  | 'business'
  // HTTP 状态码不是 2xx
  | 'http'
  // 未登录或登录已过期：HTTP 401 或业务码 401
  | 'unauthorized'
  // 没有收到响应
  | 'network'
  | 'timeout'
  // 调用方通过 AbortSignal 取消
  | 'canceled'
  // 响应格式与 schema 不符
  | 'invalid-response';

interface ApiErrorOptions {
  kind: ApiErrorKind;
  /** 给用户看的提示 */
  message: string;
  status?: number;
  code?: number;
  url?: string;
  cause?: unknown;
}

/** 请求失败时抛出的错误 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP 状态码 */
  readonly status: number | undefined;
  /** 响应中的业务码 */
  readonly code: number | undefined;
  readonly url: string | undefined;

  constructor({ kind, message, status, code, url, cause }: ApiErrorOptions) {
    super(message, { cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.url = url;
  }
}
