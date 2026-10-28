import { z } from 'zod';
import { fetchFile } from '@/shared/file-transfer';
import { http, type TransferProgress } from '@/shared/http/client';

// 2026-10-27 只读核对时 /statistics/page 一条记录都没有（docs/migration.md）。字段按旧页面读的写
// （applyApiService 的 normalizeStatisticsReportRecord），类型待联调核对：年份和时间照接口给的原样显示；
// 状态是字符串，认得数据准备的四个值（shared/data-request 的 prepare-status），其他的原样显示
const reportSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    year: z.union([z.number().int(), z.string()]).optional(),
    startTime: z.string().optional(),
    finishTime: z.string().optional(),
    status: z.string()
  })
  .transform(row => ({
    id: row.id,
    name: row.name,
    year: row.year === undefined ? undefined : String(row.year),
    startTime: row.startTime,
    finishTime: row.finishTime,
    status: row.status
  }));

export type Report = z.infer<typeof reportSchema>;

// 和申请列表同一个后端的 PageHelper 分页，只取用得到的字段
const reportPageSchema = z.object({
  list: z.array(reportSchema),
  total: z.number().int().nonnegative(),
  pageNum: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pages: z.number().int().nonnegative()
});

export type ReportPage = z.infer<typeof reportPageSchema>;

/** 报表名称，空字符串表示不筛选 */
export interface ReportFilters {
  name: string;
}

export interface ReportPageParams extends ReportFilters {
  pageNum: number;
  pageSize: number;
}

/** POST 是分页读取，可以取消；正文字段沿用旧页面 */
export function fetchReportPage(params: ReportPageParams, signal?: AbortSignal) {
  const body = { name: params.name, pageNum: params.pageNum, pageSize: params.pageSize };
  return http.post('/statistics/page', body, { schema: reportPageSchema, signal, silent: true });
}

/** 下载报表：GET，ID 在 query 里（旧页面的调用）；出错时不弹全局提示，由页面提示 */
export function fetchReportFile(
  report: Pick<Report, 'id' | 'name'>,
  signal: AbortSignal,
  onProgress: (progress: TransferProgress) => void
) {
  return fetchFile('/statistics/download', {
    query: { id: report.id },
    fallbackName: `${report.name}.zip`,
    signal,
    onDownloadProgress: onProgress,
    silent: true
  });
}
