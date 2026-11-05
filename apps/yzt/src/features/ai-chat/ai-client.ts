import type { z } from 'zod';
import { appConfig } from '@/shared/config/app-config';
import { getHttpHooks } from '@/shared/http/configure';
import { ApiError } from '@/shared/http/errors';
import {
  INVALID_RESPONSE_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  resolveErrorMessage,
  TIMEOUT_ERROR_MESSAGE
} from '@/shared/http/messages';
import { LineSplitter, sseData } from './sse';
import { useAiAuthStore } from './store';

// AI 后端是第二个服务：Bearer 鉴权、返回体没有信封、回答用 SSE 推送；shared/http 只服务主后端，
// 它的 401 会结束系统的登录会话，所以这里单独请求，错误仍转成 ApiError、提示仍交给 app 注入的 onError（docs/modules/ai-chat.md）

/** AI 后端的 401 只说明 AI 的凭据无效，不结束系统的登录会话 */
export const AI_UNAUTHORIZED_MESSAGE = 'AI 服务未登录或登录已过期';

const DEFAULT_TIMEOUT = 60_000;
const TIMEOUT_REASON = new Error('请求超时');

export interface AiRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, string | number>;
  /** 按 JSON 发送 */
  body?: unknown;
  signal?: AbortSignal;
  /** 为 true 时出错不触发全局提示，由调用方自己处理 */
  silent?: boolean;
  /** 毫秒，默认 60 秒；null 表示不限时（回答可能要几分钟） */
  timeout?: number | null;
}

/** AI 后端的完整地址；fetch 要求绝对地址，所以按页面的源补全 */
export function aiUrl(path: string, query?: Record<string, string | number>): string {
  const url = new URL(`${appConfig.aiApiBaseUrl}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.href;
}

function requestHeaders(json: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) {
    headers['Content-Type'] = 'application/json';
  }
  const { token } = useAiAuthStore();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function invalidResponse(url: string, cause?: unknown): ApiError {
  return new ApiError({ kind: 'invalid-response', message: INVALID_RESPONSE_MESSAGE, url, cause });
}

function statusError(status: number, url: string): ApiError {
  if (status === 401) {
    return new ApiError({ kind: 'unauthorized', message: AI_UNAUTHORIZED_MESSAGE, status, url });
  }
  return new ApiError({ kind: 'http', message: resolveErrorMessage(status), status, url });
}

// 中止优先：取消或超时后，不论收到了什么错误都按中止处理
function toApiError(error: unknown, signal: AbortSignal, url: string): ApiError {
  if (signal.aborted) {
    return signal.reason === TIMEOUT_REASON
      ? new ApiError({ kind: 'timeout', message: TIMEOUT_ERROR_MESSAGE, url })
      : new ApiError({ kind: 'canceled', message: '请求已取消', url });
  }
  if (error instanceof ApiError) {
    return error;
  }
  return new ApiError({ kind: 'network', message: NETWORK_ERROR_MESSAGE, url, cause: error });
}

async function request<Result>(
  path: string,
  options: AiRequestOptions,
  read: (response: Response, url: string, signal: AbortSignal) => Promise<Result>
): Promise<Result> {
  const { method = 'GET', query, body, signal, silent = false, timeout = DEFAULT_TIMEOUT } = options;
  const url = aiUrl(path, query);
  if (signal?.aborted) {
    throw new ApiError({ kind: 'canceled', message: '请求已取消', url });
  }
  const controller = new AbortController();
  const abortByCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortByCaller, { once: true });
  const timer = timeout === null ? undefined : setTimeout(() => controller.abort(TIMEOUT_REASON), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      throw statusError(response.status, url);
    }
    const result = await read(response, url, controller.signal);
    // 读完后才被中止的，晚到的结果不交给调用方
    if (controller.signal.aborted) {
      throw toApiError(undefined, controller.signal, url);
    }
    return result;
  } catch (error) {
    const apiError = toApiError(error, controller.signal, url);
    if (apiError.kind !== 'canceled' && !silent) {
      getHttpHooks().onError?.(apiError);
    }
    throw apiError;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortByCaller);
    // 读取中途出错时释放连接
    controller.abort();
  }
}

/** 请求 JSON 接口，返回体整体按 schema 校验；空的返回体按 undefined 校验 */
export function aiRequest<Schema extends z.ZodType>(
  path: string,
  options: AiRequestOptions & { schema: Schema }
): Promise<z.output<Schema>> {
  return request(path, options, async (response, url) => {
    const text = await response.text();
    let body: unknown;
    try {
      body = text === '' ? undefined : JSON.parse(text);
    } catch (cause) {
      throw invalidResponse(url, cause);
    }
    const parsed = options.schema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponse(url, parsed.error);
    }
    return parsed.data;
  });
}

/** 以 SSE 读取回答：每行 data 交给 onData 解析，onData 抛错时结束读取，不是 ApiError 的按返回格式不正确处理；不限时 */
export function aiStream(
  path: string,
  options: Omit<AiRequestOptions, 'timeout'> & { onData: (data: string) => void }
): Promise<void> {
  return request(path, { ...options, timeout: null }, async (response, url, signal) => {
    if (!response.body) {
      throw invalidResponse(url);
    }
    const reader = response.body.getReader();
    // 中止时结束正在等待的读取：不是每种环境都会让中止的 fetch 的响应体读取出错
    const cancel = () => void reader.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    const decoder = new TextDecoder();
    const splitter = new LineSplitter();
    try {
      let done = false;
      while (!done) {
        // oxlint-disable-next-line no-await-in-loop -- 流只能按顺序一块一块地读
        const chunk = await reader.read();
        done = chunk.done;
        const lines = chunk.done
          ? [...splitter.push(decoder.decode()), ...splitter.flush()]
          : splitter.push(decoder.decode(chunk.value, { stream: true }));
        for (const line of lines) {
          const data = sseData(line);
          // 中止后读到的内容不再交出，由 request 按中止结束
          if (signal.aborted) {
            return;
          }
          if (data === null) {
            continue;
          }
          try {
            options.onData(data);
          } catch (error) {
            throw error instanceof ApiError ? error : invalidResponse(url, error);
          }
        }
      }
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  });
}
