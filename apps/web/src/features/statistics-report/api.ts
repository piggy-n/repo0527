import { z } from 'zod';
import type { PrepareStatus } from '@/shared/data-request/prepare-status';
import { fetchFile } from '@/shared/file-transfer';
import { http, type TransferProgress } from '@/shared/http/client';

// 状态是后端的中文文字，和申请的 storage_status（英文）不是一套；见过的取值见 docs/migration.md。
// 未处理和认不出的返回 undefined，界面原样显示文字、不能下载
function prepareStatusOf(text: string): PrepareStatus | undefined {
  if (text === '处理成功' || text === '处理完成') {
    return 'success';
  }
  if (text.includes('正在处理')) {
    return 'processing';
  }
  return text === '处理失败' ? 'failed' : undefined;
}

// 字段按联调拿到的返回（docs/migration.md），用不到的（type、level、createdTime 等）解析时丢弃。
// 没有值的键写成 null：这个返回里每行的 pageNum、pageSize 就是，没开始、没完成的任务的时间同样按 null
const reportSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    year: z.string(),
    startTime: z.string().nullable(),
    finishTime: z.string().nullable(),
    status: z.string()
  })
  .transform(row => ({ ...row, status: prepareStatusOf(row.status), statusText: row.status }));

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
