import { z } from 'zod';
import { formatBeijingDateTime } from '@/shared/data-request/date-time';
import { http } from '@/shared/http/client';

// 字段按 2026-10-27 只读核对的真实返回（docs/migration.md）：没有值的字段整个键都不出现，所以写 optional 而不是 nullable；
// 用不到的字段（user_id、receiver_dept_code、xzqdm、file_path、storage_progess 等）不声明，解析时丢弃

/** 申请的状态；table 是后端混在申请表里的基本统计任务（ADR 0091） */
const applicationStatusSchema = z.enum(['pending', 'approved', 'rejected', 'table']);

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/** 审核的结果，筛选条件也用它 */
export type AuditStatus = Exclude<ApplicationStatus, 'table'>;

/** 数据准备的状态（storage_status）；取值沿用旧页面的筛选项，实测只见过 timeout，没有这个字段时还没开始准备 */
const prepareStatusSchema = z.enum(['processing', 'success', 'timeout', 'failed']);

export type PrepareStatus = z.infer<typeof prepareStatusSchema>;

// 带时区的时间，如 2026-10-28T03:29:36.527+00:00，显示为北京时间（和消息里的时间一致）
const dateTimeSchema = z.iso.datetime({ offset: true }).transform(value => formatBeijingDateTime(new Date(value)));

const applicationSchema = z
  .object({
    apply_id: z.string().min(1),
    apply_name: z.string().optional(),
    // 实测待审核的申请没有申请人（后端问题，记在 migration.md）
    user_name: z.string().optional(),
    receiver_dept_name: z.string(),
    layer_code: z.string().optional(),
    xzqmc: z.string().optional(),
    create_time: dateTimeSchema.optional(),
    start_date: dateTimeSchema,
    end_date: dateTimeSchema,
    // 小写逗号串，如 excel,shp；统计任务是 .zip
    data_formats: z.string(),
    apply_purpose: z.string().optional(),
    status: applicationStatusSchema,
    // 不通过的原因；审核通过的申请是空字符串
    remark: z.string().optional(),
    storage_status: prepareStatusSchema.optional()
  })
  .transform(row => ({
    id: row.apply_id,
    name: row.apply_name,
    applicant: row.user_name,
    department: row.receiver_dept_name,
    layerCode: row.layer_code,
    region: row.xzqmc,
    appliedAt: row.create_time,
    startTime: row.start_date,
    endTime: row.end_date,
    formats: row.data_formats.split(','),
    purpose: row.apply_purpose,
    status: row.status,
    reason: row.remark,
    prepare: row.storage_status
  }));

export type Application = z.infer<typeof applicationSchema>;

// PageHelper 的分页结构，只取用得到的字段。页码越界时后端改成最后一页并返回那一页的数据；
// 没有数据时原样返回请求的页码，pages 是 0（2026-10-27 实测）
const applicationPageSchema = z.object({
  list: z.array(applicationSchema),
  total: z.number().int().nonnegative(),
  pageNum: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pages: z.number().int().nonnegative()
});

export type ApplicationPage = z.infer<typeof applicationPageSchema>;

/** 列表的筛选条件；空字符串表示不筛选 */
export interface ApplicationFilters {
  name: string;
  status: AuditStatus | '';
  prepare: PrepareStatus | '';
}

export interface ApplicationPageParams extends ApplicationFilters {
  pageNum: number;
  pageSize: number;
}

/** POST 是分页读取，可以取消；字段名沿用旧页面（名称 applyName、准备状态 taskStatus），空字符串不筛选（2026-10-27 实测） */
export function fetchApplicationPage(params: ApplicationPageParams, signal?: AbortSignal) {
  const body = {
    applyName: params.name,
    status: params.status,
    taskStatus: params.prepare,
    pageNum: params.pageNum,
    pageSize: params.pageSize
  };
  return http.post('/api/apply/list', body, { schema: applicationPageSchema, signal, silent: true });
}

/** 一条申请；ID 不存在时接口返回 data: null（实测），这里得到 null */
export function fetchApplication(id: string, signal?: AbortSignal) {
  return http.get(`/api/apply/${encodeURIComponent(id)}`, {
    schema: applicationSchema
      .nullable()
      .refine(application => application === null || application.id === id, '申请 ID 不匹配'),
    signal,
    silent: true
  });
}

export interface ApplicationAudit {
  id: string;
  approved: boolean;
  // 不通过的原因；通过时不发送
  reason: string;
}

/**
 * 审核申请：结果和原因放在 query 里，没有正文（旧页面的调用）；通过时原因传空字符串。
 * 成功的 data 没有实测（不对真实后端做写操作），只判断业务码、丢弃 data
 */
export function auditApplication(audit: ApplicationAudit) {
  return http.post(`/api/apply/status/${encodeURIComponent(audit.id)}`, undefined, {
    query: { status: audit.approved ? 'approved' : 'rejected', reason: audit.approved ? '' : audit.reason },
    schema: z.unknown().transform(() => undefined),
    silent: true
  });
}
