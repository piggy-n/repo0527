// 整理瓦片集索引时的下载（docs/modules/map-core.md"索引的下载"）：所有瓦片集共用名额，暂时的失败退避重试
import { abortReason } from '@mx/utils';
import type { LoadJson } from './prepare-tileset';

/**
 * 同时下载的索引数：Chromium 每个渲染进程最多 2700 个未完成的请求，超出的立即失败；
 * HTTP/1.1 下浏览器对一台服务器只开 6 条连接，再多也只是在浏览器里排队
 */
export const MAX_INDEX_DOWNLOADS = 16;

/** 暂时的失败每次重试前等的毫秒数，个数就是重试次数 */
export const INDEX_RETRY_DELAYS: readonly number[] = [500, 2000];

/** 下载时服务器回了不是 2xx 的状态码 */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(url: string, status: number) {
    super(`下载 ${url} 失败：${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

/** 用 fetch 下载 JSON；状态码不是 2xx 时以 HttpStatusError 结束 */
export async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new HttpStatusError(url, response.status);
  }
  const data: unknown = await response.json();
  return data;
}

// 值得重试的失败：网络错误（fetch 抛 TypeError，包括超出浏览器的请求上限）、服务器错误、超时、限流
function isTransient(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  return error instanceof HttpStatusError && (error.status >= 500 || error.status === 408 || error.status === 429);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// 下载名额：先到先得，用完的直接交给排在最前的；中止的离开队伍
class Slots {
  #free: number;
  readonly #waiting = new Set<() => void>();

  constructor(count: number) {
    this.#free = count;
  }

  acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(abortReason(signal));
    }
    if (this.#free > 0) {
      this.#free--;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const take = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        this.#waiting.delete(take);
        reject(abortReason(signal));
      };
      this.#waiting.add(take);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  release(): void {
    const [next] = this.#waiting;
    if (next) {
      this.#waiting.delete(next);
      next();
    } else {
      this.#free++;
    }
  }
}

export interface IndexLoaderOptions {
  /** 同时下载的个数，不传是 MAX_INDEX_DOWNLOADS */
  readonly maxDownloads?: number;
  /** 重试前等的毫秒数，不传是 INDEX_RETRY_DELAYS */
  readonly retryDelays?: readonly number[];
}

/**
 * 整理索引用的下载：经它的下载共用 maxDownloads 个名额，先到先下；网络错误、服务器错误按 retryDelays 等一会儿再试，
 * 等的时候不占名额。signal 中止时排队、等待中的以它的原因结束，不再下载
 */
export function createIndexLoader(load: LoadJson, options: IndexLoaderOptions = {}): LoadJson {
  const { maxDownloads = MAX_INDEX_DOWNLOADS, retryDelays = INDEX_RETRY_DELAYS } = options;
  const slots = new Slots(maxDownloads);
  const download = async (url: string, signal: AbortSignal): Promise<unknown> => {
    await slots.acquire(signal);
    try {
      // 名额交到手里之前可能已经中止
      signal.throwIfAborted();
      return await load(url, signal);
    } finally {
      slots.release();
    }
  };
  const attempt = async (url: string, signal: AbortSignal, retry: number): Promise<unknown> => {
    let failure: unknown;
    try {
      return await download(url, signal);
    } catch (error) {
      failure = error;
    }
    const delay = retryDelays[retry];
    if (signal.aborted || delay === undefined || !isTransient(failure)) {
      throw failure;
    }
    await wait(delay, signal);
    return attempt(url, signal, retry + 1);
  };
  return (url, signal) => attempt(url, signal, 0);
}
