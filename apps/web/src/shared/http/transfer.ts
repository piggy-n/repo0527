import type { AxiosProgressEvent } from 'axios';

/** 已传输字节；总量未知时不提供百分比 */
export interface TransferProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

/** 将底层进度转为业务无关的数据；active 为 false（请求已结束或中止）时不再上报 */
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
    // 总量为 0 或未知时（如分块传输）不伪造百分比
    const total = event.lengthComputable && event.total !== undefined && event.total > 0 ? event.total : null;
    const progress: TransferProgress = {
      loaded: event.loaded,
      total,
      percent: total === null ? null : Math.min(100, event.loaded / total * 100)
    };
    // 回调属于调用方，它抛错时只打印，不能打断传输
    try {
      callback(progress);
    } catch (error) {
      console.error('[http] 传输进度回调抛出了异常', error);
    }
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
