import { type BinaryRequestOptions, http } from '../http/client';
import { baseMimeType } from '../http/transfer';
import { downloadFileName } from './file-name';

export type { TransferProgress } from '../http/client';

/** 文件接口的后备名称与已知类型由业务提供 */
export interface FetchFileOptions extends BinaryRequestOptions {
  method?: 'get' | 'post';
  fallbackName: string;
  fallbackType?: string;
}

/** 可交给预览或浏览器保存的文件 */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/** 读取文件，识别错误后再整理文件名和缺失的 MIME；不触发保存或提示，取消后不交出晚到的结果 */
export async function fetchFile(url: string, options: FetchFileOptions): Promise<DownloadedFile> {
  const { fallbackName, fallbackType, method = 'get', ...requestOptions } = options;
  const response = method === 'post'
    ? await http.postBlob(url, undefined, requestOptions)
    : await http.getBlob(url, requestOptions);
  // 只补缺失或通用的类型，不覆盖服务端明确给出的类型
  const mime = baseMimeType(response.contentType ?? response.blob.type);
  const blob = fallbackType && (!mime || mime === 'application/octet-stream')
    ? new Blob([response.blob], { type: fallbackType })
    : response.blob;
  return { blob, fileName: downloadFileName(response.contentDisposition, fallbackName) };
}

// 浏览器没有“写入磁盘完成”事件，给已触发的下载保留读取时间后释放 URL
const DOWNLOAD_URL_LIFETIME = 60_000;

/** 将内容交给浏览器保存；调用成功不表示用户已经完成保存 */
export function saveFile(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = downloadFileName(null, file.fileName);
  link.hidden = true;
  try {
    document.body.append(link);
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME);
}
