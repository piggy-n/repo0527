import { useRowDownloads } from '@/shared/file-transfer/useRowDownloads';
import { fetchReportFile, type Report } from '../api';

/** 统计报表的下载：按报表 ID 防重复、记下进度（shared/file-transfer 的 useRowDownloads） */
export function useReportDownloads() {
  return useRowDownloads((report: Report) => report.id, fetchReportFile);
}
