import { useRowDownloads } from '@/shared/file-transfer/useRowDownloads';
import { type Application, fetchApplicationFile } from '../api';

/** 申请数据的下载：按申请 ID 防重复、记下进度（shared/file-transfer 的 useRowDownloads） */
export function useApplicationDownloads() {
  return useRowDownloads((application: Application) => application.id, fetchApplicationFile);
}
