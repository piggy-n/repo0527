import type { AxiosProgressEvent } from 'axios';
import { safeReporter } from '@yzt/utils';

/** 已传输字节；总量未知时不提供百分比 */
export interface TransferProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

/** 将底层进度转为业务无关的数据，回调异常不打断传输 */
export function progressReporter(
  callback: ((progress: TransferProgress) => void) | undefined,
  active: () => boolean
): ((event: AxiosProgressEvent) => void) | undefined {
  if (!callback) {
    return undefined;
  }
  return event => {
    if (!active()) {
      return;
    }
    const total = event.lengthComputable && event.total !== undefined && event.total > 0 ? event.total : null;
    const progress: TransferProgress = {
      loaded: event.loaded,
      total,
      percent: total === null ? null : Math.min(100, event.loaded / total * 100)
    };
    safeReporter(() => callback(progress), 'HTTP 传输进度')(undefined);
  };
}

/** 用可取消的读取识别小型错误响应，避免将整个大文件解码成字符串 */
export function readBlobText(blob: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      reader.removeEventListener('load', loaded);
      reader.removeEventListener('error', failed);
    };
    const abort = () => {
      cleanup();
      reader.abort();
      reject(new DOMException('读取已取消', 'AbortError'));
    };
    const loaded = () => {
      cleanup();
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    const failed = () => {
      cleanup();
      reject(reader.error ?? new Error('文件内容读取失败'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    reader.addEventListener('load', loaded, { once: true });
    reader.addEventListener('error', failed, { once: true });
    reader.readAsText(blob);
  });
}
