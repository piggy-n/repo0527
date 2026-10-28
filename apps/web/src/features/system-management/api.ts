import { z } from 'zod';
import { fetchFile } from '@/shared/file-transfer';
import { http, type TransferProgress } from '@/shared/http/client';

// 按旧实际调用字段接入；真实记录及审核返回仍待联调，见 docs/stages/ai-system-management-migration.md
const applicationSchema = z.object({
  apply_id: z.string().min(1),
  apply_name: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'table']),
  xzqmc: z.string().nullish(),
  create_time: z.string().nullish(),
  receiver_dept_name: z.string().nullish(),
  layer_code: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  data_formats: z.string().nullish(),
  apply_purpose: z.string().nullish(),
  remark: z.string().nullish(),
  storage_status: z.string().nullish()
});

const reportSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  year: z.string().nullish(),
  startTime: z.string().nullish(),
  finishTime: z.string().nullish(),
  status: z.string().nullish()
});

// 列表保留各自字段，不拼出含大量空值的通用资源对象
const applicationRowSchema = applicationSchema.transform(row => ({ ...row, kind: 'audit' as const }));
const reportRowSchema = reportSchema.transform(row => ({ ...row, kind: 'reports' as const }));
const pagination = {
  total: z.number().int().nonnegative(),
  pageNum: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pages: z.number().int().nonnegative()
};
const applicationPageSchema = z.object({ ...pagination, list: z.array(applicationRowSchema) });
const reportPageSchema = z.object({ ...pagination, list: z.array(reportRowSchema) });

export type Application = z.infer<typeof applicationSchema>;
export type SystemRow = z.infer<typeof applicationRowSchema> | z.infer<typeof reportRowSchema>;
export type SystemPage = z.infer<typeof applicationPageSchema> | z.infer<typeof reportPageSchema>;
export type SystemSection = SystemRow['kind'];
export type AuditDecision = 'approved' | 'rejected';

/** 表单的全部选项只在请求边界转换为空字符串 */
export interface SystemFilters {
  name: string;
  status: 'all' | 'pending' | AuditDecision;
  taskStatus: 'all' | 'waiting' | 'processing' | 'success' | 'timeout' | 'failed';
}

export interface SystemPageRequest extends SystemFilters {
  section: SystemSection;
  pageNum: number;
  pageSize: number;
}

/** 两类列表各用自己的请求体与 schema */
export async function fetchSystemPage(request: SystemPageRequest, signal?: AbortSignal): Promise<SystemPage> {
  const { pageNum, pageSize, name, status, taskStatus } = request;
  if (request.section === 'reports') {
    const options = { schema: reportPageSchema, signal, silent: true };
    return http.post('/statistics/page', { pageNum, pageSize, name }, options);
  }
  const body = {
    pageNum,
    pageSize,
    applyName: name,
    status: status === 'all' ? '' : status,
    taskStatus: taskStatus === 'all' ? '' : taskStatus
  };
  return http.post('/api/apply/list', body, { schema: applicationPageSchema, signal, silent: true });
}

/** 详情必须属于请求的申请，失败不退回列表摘要 */
export function fetchApplication(id: string, signal?: AbortSignal) {
  return http.get(`/api/apply/${encodeURIComponent(id)}`, {
    schema: applicationSchema.refine(row => row.apply_id === id, '申请身份与请求不一致'),
    signal,
    silent: true
  });
}

export interface AuditInput {
  id: string;
  status: AuditDecision;
  reason: string;
}

/** 审核为服务端写操作，不随弹窗关闭取消；目前只验证公共业务码，丢弃未确认的 data */
export function auditApplication({ id, status, reason }: AuditInput) {
  return http.post(`/api/apply/status/${encodeURIComponent(id)}`, undefined, {
    query: { status, reason: status === 'rejected' ? reason : '' },
    schema: z.unknown().transform(() => undefined),
    silent: true
  });
}

/** 下载任务 ID 含模块前缀，两个接口的同名 ID 不互相覆盖 */
export interface SystemDownloadTarget {
  id: string;
  recordId: string;
  name: string;
  section: SystemSection;
}

export function fetchSystemFile(
  target: SystemDownloadTarget,
  signal: AbortSignal,
  onProgress: (progress: TransferProgress) => void
) {
  const audit = target.section === 'audit';
  const url = audit ? `/api/apply/download/${encodeURIComponent(target.recordId)}` : '/statistics/download';
  return fetchFile(url, {
    method: audit ? 'post' : 'get',
    query: audit ? undefined : { id: target.recordId },
    fallbackName: /\.zip$/i.test(target.name) ? target.name : `${target.name}.zip`,
    signal,
    onDownloadProgress: onProgress,
    silent: true
  });
}
