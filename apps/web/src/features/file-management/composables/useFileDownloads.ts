import { useDownloads, type DownloadTask } from '@/shared/file-transfer/useDownloads';
import { fetchFileContent } from '../api';
import type { FileTransferTarget } from '../file-types';

export type FileDownloadTask = DownloadTask<FileTransferTarget>;

/** 文件管理提供取流参数，共享下载任务与取消流程 */
export function useFileDownloads() {
  return useDownloads(fetchFileContent);
}
