import { type AxiosRequestConfig, create, isAxiosError, isCancel } from 'axios';
import { z } from 'zod';
import { appConfig } from '../config/app-config';
import { getHttpHooks, type SentRequest } from './configure';
import { ApiError } from './errors';
import {
  INVALID_RESPONSE_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  resolveErrorMessage,
  TIMEOUT_ERROR_MESSAGE,
  UNAUTHORIZED_MESSAGE
} from './messages';

const SUCCESS_CODE = 200;

// 后端统一的响应外层；出错时没有 data 字段，zod 4 中 z.unknown() 的字段默认必填，要显式写 optional
const envelopeSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
  data: z.unknown().optional()
});

// 出错时响应体里可能带有 msg
const errorBodySchema = z.object({ msg: z.string() });

// 没有信封的接口（ADR 0047）出错时仍返回信封，按业务码区分：成功的返回体没有 code
const rawFailureSchema = z.object({
  code: z.number().refine(code => code !== SUCCESS_CODE),
  msg: z.string().nullish()
});

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions<Schema extends z.ZodType> {
  /** 响应中 data 字段的 schema，返回值类型由它推断 */
  schema: Schema;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** 为 true 时出错不触发全局提示，由调用方自己处理 */
  silent?: boolean;
  /** 毫秒，默认 60 秒 */
  timeout?: number;
  /** 为 false 时返回体没有 { code, msg, data } 外层，成功时整体按 schema 校验（ADR 0047 第 8 节） */
  envelope?: boolean;
}

const DEFAULT_TIMEOUT = 60_000;

// 超时和调用方取消都通过中止请求实现，用中止原因区分；不用 axios 的 timeout：它依赖 XHR 的 timeout，MSW 模拟响应时不会触发，测不到
const TIMEOUT_REASON = new Error('请求超时');

const instance = create({ baseURL: appConfig.apiBaseUrl });

function invalidResponse(url: string | undefined, cause: unknown): ApiError {
  return new ApiError({ kind: 'invalid-response', message: INVALID_RESPONSE_MESSAGE, url, cause });
}

function businessError(code: number, msg: string | null | undefined, url?: string): ApiError {
  return new ApiError({
    kind: code === 401 ? 'unauthorized' : 'business',
    message: resolveErrorMessage(code, msg ?? undefined),
    code,
    url
  });
}

// 没有信封的返回体：出错时的信封按业务错误处理，否则整体按 schema 校验
function parseRawResponse<Schema extends z.ZodType>(body: unknown, schema: Schema, url?: string): z.output<Schema> {
  const failure = rawFailureSchema.safeParse(body);
  if (failure.success) {
    throw businessError(failure.data.code, failure.data.msg, url);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw invalidResponse(url, parsed.error);
  }
  return parsed.data;
}

function parseResponse<Schema extends z.ZodType>(body: unknown, schema: Schema, url?: string): z.output<Schema> {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw invalidResponse(url, envelope.error);
  }

  const { code, msg, data } = envelope.data;
  if (code !== SUCCESS_CODE) {
    throw businessError(code, msg, url);
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw invalidResponse(url, parsed.error);
  }
  return parsed.data;
}

function toApiError(error: unknown, abortReason: unknown, url?: string): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (isCancel(error)) {
    return abortReason === TIMEOUT_REASON
      ? new ApiError({ kind: 'timeout', message: TIMEOUT_ERROR_MESSAGE, url, cause: error })
      : new ApiError({ kind: 'canceled', message: '请求已取消', url, cause: error });
  }
  // instanceof 收窄出的是 AxiosError<any>，用带泛型的类型守卫把响应体限定为 unknown
  if (isAxiosError<unknown>(error)) {
    if (error.response) {
      const { status, data } = error.response;
      const body = errorBodySchema.safeParse(data);
      return new ApiError({
        kind: status === 401 ? 'unauthorized' : 'http',
        message: resolveErrorMessage(status, body.success ? body.data.msg : undefined),
        status,
        url,
        cause: error
      });
    }
  }
  return new ApiError({ kind: 'network', message: NETWORK_ERROR_MESSAGE, url, cause: error });
}

function notify(error: ApiError, silent: boolean, sent: SentRequest): void {
  const { onUnauthorized, onError } = getHttpHooks();
  if (error.kind === 'canceled') {
    return;
  }
  if (error.kind === 'unauthorized') {
    onUnauthorized?.(error, sent);
    return;
  }
  if (!silent) {
    onError?.(error);
  }
}

async function request<Schema extends z.ZodType>(
  config: AxiosRequestConfig,
  options: RequestOptions<Schema>
): Promise<z.output<Schema>> {
  const { schema, query, signal, silent = false, timeout = DEFAULT_TIMEOUT, envelope = true } = options;
  const { getHeaders, isCredentialExpired } = getHttpHooks();
  const headers = getHeaders?.() ?? {};
  // 登录已过期时不发出请求，与收到 401 同样处理；放在创建定时器之前，提前结束时不用清理
  if (isCredentialExpired?.()) {
    const error = new ApiError({ kind: 'unauthorized', message: UNAUTHORIZED_MESSAGE, url: config.url });
    notify(error, silent, { headers });
    throw error;
  }
  const controller = new AbortController();
  const abortByCaller = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(TIMEOUT_REASON), timeout);
  if (signal?.aborted) {
    abortByCaller();
  }
  signal?.addEventListener('abort', abortByCaller, { once: true });

  try {
    const response = await instance.request<unknown>({
      ...config,
      params: query,
      signal: controller.signal,
      headers
    });
    return envelope
      ? parseResponse(response.data, schema, config.url)
      : parseRawResponse(response.data, schema, config.url);
  } catch (error) {
    const apiError = toApiError(error, controller.signal.reason, config.url);
    notify(apiError, silent, { headers });
    throw apiError;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortByCaller);
  }
}

/** 调用后端接口：成功时返回按 schema 校验过的 data，失败时抛出 ApiError */
export const http = {
  get: <Schema extends z.ZodType>(url: string, options: RequestOptions<Schema>) =>
    request({ method: 'get', url }, options),
  delete: <Schema extends z.ZodType>(url: string, options: RequestOptions<Schema>) =>
    request({ method: 'delete', url }, options),
  post: <Schema extends z.ZodType>(url: string, body: unknown, options: RequestOptions<Schema>) =>
    request({ method: 'post', url, data: body }, options),
  put: <Schema extends z.ZodType>(url: string, body: unknown, options: RequestOptions<Schema>) =>
    request({ method: 'put', url, data: body }, options)
};
