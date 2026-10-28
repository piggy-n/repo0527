import { type AxiosRequestConfig, type AxiosResponse, create, isAxiosError } from 'axios';
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
import { baseMimeType, progressReporter, readBlobText, type TransferProgress } from './transfer';

export type { TransferProgress } from './transfer';

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

export interface HttpRequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** 为 true 时出错不触发全局提示，由调用方自己处理 */
  silent?: boolean;
  /** 毫秒，默认 60 秒 */
  timeout?: number;
}

export interface RequestOptions<Schema extends z.ZodType> extends HttpRequestOptions {
  /** 响应中 data 字段的 schema，返回值类型由它推断 */
  schema: Schema;
  /** 为 false 时返回体没有 { code, msg, data } 外层，成功时整体按 schema 校验（ADR 0047 第 8 节） */
  envelope?: boolean;
  /** 整个请求体的发送进度；发送完毕不表示服务端已经处理成功 */
  onUploadProgress?: (progress: TransferProgress) => void;
}

export interface BinaryRequestOptions extends HttpRequestOptions {
  /** 响应内容的接收进度，不表示文件已经保存到磁盘 */
  onDownloadProgress?: (progress: TransferProgress) => void;
}

/** 文件响应，只暴露内容与文件相关的响应头 */
export interface BinaryResponse {
  blob: Blob;
  contentType: string | null;
  contentDisposition: string | null;
}

// 两种进度只在各自的入口开放（上传在 JSON 接口，下载在 getBlob、postBlob），内部的请求函数一并接收
interface TransferRequestOptions extends HttpRequestOptions {
  onUploadProgress?: (progress: TransferProgress) => void;
  onDownloadProgress?: (progress: TransferProgress) => void;
}

const DEFAULT_TIMEOUT = 60_000;

// 超时和调用方取消都通过中止请求实现，用中止原因区分；不用 axios 的 timeout：它依赖 XHR 的 timeout，MSW 模拟响应时不会触发，测不到
const TIMEOUT_REASON = new Error('请求超时');

const instance = create({ baseURL: appConfig.apiBaseUrl });

// 错误信封只读取小块内容，文件本身仍保持 Blob；超出范围的 HTTP 错误使用状态码提示
const ERROR_BODY_LIMIT = 64 * 1024;

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function responseHeader(response: AxiosResponse<unknown>, name: string): string | null {
  const value: unknown = response.headers[name];
  return typeof value === 'string' ? value : null;
}

/** 文件接口也可能返回 JSON 错误；先识别失败信封，再交出二进制内容 */
async function parseBinaryResponse(response: AxiosResponse<unknown>, signal: AbortSignal): Promise<BinaryResponse> {
  const blob = z.instanceof(Blob).safeParse(response.data);
  if (!blob.success) {
    throw invalidResponse(response.config.url, blob.error);
  }
  const contentType = responseHeader(response, 'content-type');
  const contentDisposition = responseHeader(response, 'content-disposition');
  const mime = baseMimeType(contentType ?? blob.data.type);
  const json = mime === 'application/json' || mime.endsWith('+json');
  const html = mime === 'text/html' || mime === 'application/xhtml+xml';
  const generic = !mime || mime === 'application/octet-stream' || mime === 'text/plain';
  const attachment = contentDisposition !== null && /^attachment(?:;|$)/i.test(contentDisposition.trim());
  // 只有可能装着错误信封或错误页面的类型才读开头一段；明确的二进制类型（PDF、图片等）直接交出
  if (json || html || generic) {
    let text: string;
    try {
      text = await readBlobText(blob.data.slice(0, ERROR_BODY_LIMIT), signal);
    } catch (cause) {
      throw invalidResponse(response.config.url, cause);
    }
    const body = blob.data.size <= ERROR_BODY_LIMIT ? tryJson(text) : undefined;
    const failure = rawFailureSchema.safeParse(body);
    if (failure.success) {
      throw businessError(failure.data.code, failure.data.msg, response.config.url);
    }
    // 信封不是文件；JSON/HTML 的真实附件可以下载，无附件声明的异常页面不能当文档保存
    const unexpectedPage = !attachment && (json || html || /^\s*<(?:!doctype html|html)\b/i.test(text));
    if (envelopeSchema.safeParse(body).success || unexpectedPage) {
      throw invalidResponse(response.config.url, undefined);
    }
  }
  return { blob: blob.data, contentType, contentDisposition };
}

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

function abortedError(reason: unknown, url?: string): ApiError {
  return reason === TIMEOUT_REASON
    ? new ApiError({ kind: 'timeout', message: TIMEOUT_ERROR_MESSAGE, url })
    : new ApiError({ kind: 'canceled', message: '请求已取消', url });
}

// 中止优先：请求被取消或超时后，不论收到了什么错误都按中止处理（axios 的 CanceledError 也在这里）
async function toApiError(error: unknown, signal: AbortSignal, url?: string): Promise<ApiError> {
  if (signal.aborted) {
    return abortedError(signal.reason, url);
  }
  if (error instanceof ApiError) {
    return error;
  }
  // instanceof 收窄出的是 AxiosError<any>，用带泛型的类型守卫把响应体限定为 unknown
  if (isAxiosError<unknown>(error)) {
    if (error.response) {
      const { status, data } = error.response;
      let errorBody: unknown = data;
      if (data instanceof Blob) {
        try {
          errorBody = data.size <= ERROR_BODY_LIMIT ? tryJson(await readBlobText(data, signal)) : undefined;
        } catch {
          // 无法读取错误体时仍按 HTTP 状态码处理，不把服务端错误变成网络错误
          errorBody = undefined;
        }
        if (signal.aborted) {
          return abortedError(signal.reason, url);
        }
      }
      const body = errorBodySchema.safeParse(errorBody);
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

async function request<Result>(
  config: AxiosRequestConfig,
  options: TransferRequestOptions,
  parse: (response: AxiosResponse<unknown>, signal: AbortSignal) => Result | Promise<Result>
): Promise<Result> {
  const { query, signal, silent = false, timeout = DEFAULT_TIMEOUT, onUploadProgress, onDownloadProgress } = options;
  // 调用方已经取消时不发请求，也不按登录过期提示
  if (signal?.aborted) {
    throw abortedError(signal.reason, config.url);
  }
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
  signal?.addEventListener('abort', abortByCaller, { once: true });
  // 请求结束或中止后不再上报进度
  let settled = false;
  const active = () => !settled && !controller.signal.aborted;

  try {
    const response = await instance.request<unknown>({
      ...config,
      params: query,
      signal: controller.signal,
      headers,
      onUploadProgress: progressReporter(onUploadProgress, active),
      onDownloadProgress: progressReporter(onDownloadProgress, active)
    });
    const result = await parse(response, controller.signal);
    // 响应到达后、解析完成前被中止的，晚到的结果不交给调用方
    if (controller.signal.aborted) {
      throw abortedError(controller.signal.reason, config.url);
    }
    return result;
  } catch (error) {
    const apiError = await toApiError(error, controller.signal, config.url);
    notify(apiError, silent, { headers });
    throw apiError;
  } finally {
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortByCaller);
  }
}

function requestJson<Schema extends z.ZodType>(config: AxiosRequestConfig, options: RequestOptions<Schema>) {
  return request(config, options, ({ data }) => {
    return options.envelope === false
      ? parseRawResponse(data, options.schema, config.url)
      : parseResponse(data, options.schema, config.url);
  });
}

/** 调用后端接口：成功时返回按 schema 校验过的 data，失败时抛出 ApiError */
export const http = {
  get: <Schema extends z.ZodType>(url: string, options: RequestOptions<Schema>) =>
    requestJson({ method: 'get', url }, options),
  delete: <Schema extends z.ZodType>(url: string, options: RequestOptions<Schema>) =>
    requestJson({ method: 'delete', url }, options),
  post: <Schema extends z.ZodType>(url: string, body: unknown, options: RequestOptions<Schema>) =>
    requestJson({ method: 'post', url, data: body }, options),
  put: <Schema extends z.ZodType>(url: string, body: unknown, options: RequestOptions<Schema>) =>
    requestJson({ method: 'put', url, data: body }, options),
  getBlob: (url: string, options: BinaryRequestOptions = {}): Promise<BinaryResponse> =>
    request({ method: 'get', url, responseType: 'blob' }, options, parseBinaryResponse),
  /** 用 POST 读取文件（如数据申请的下载）；body 为 undefined 时不发正文 */
  postBlob: (url: string, body?: unknown, options: BinaryRequestOptions = {}): Promise<BinaryResponse> =>
    request({ method: 'post', url, data: body, responseType: 'blob' }, options, parseBinaryResponse)
};
