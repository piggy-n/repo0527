import type { Application, AuditStatus, PrepareStatus } from './api';

// 旧页面管理员看到的"申核通过"是错别字，统一为"审核"（ADR 0091）
export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = {
  pending: '待审核',
  approved: '审核通过',
  rejected: '审核不通过'
};

export const PREPARE_STATUS_LABELS: Record<PrepareStatus, string> = {
  processing: '正在处理',
  success: '处理完成',
  timeout: '已过期',
  failed: '处理失败'
};

/** 筛选栏的选项，顺序和旧页面一致 */
export const AUDIT_STATUS_OPTIONS = (['pending', 'approved', 'rejected'] as const).map(value => ({
  value,
  label: AUDIT_STATUS_LABELS[value]
}));

export const PREPARE_STATUS_OPTIONS = (['processing', 'success', 'timeout', 'failed'] as const).map(value => ({
  value,
  label: PREPARE_STATUS_LABELS[value]
}));

/** 有数据准备这一步、但还没有准备状态时的文案 */
export const PREPARE_WAITING_LABEL = '未开始处理';

/** 只有审核通过的申请和统计任务才准备数据 */
export function hasPrepareStep(application: Pick<Application, 'status'>): boolean {
  return application.status === 'approved' || application.status === 'table';
}

/** 数据准备完成才能下载 */
export function canDownload(application: Pick<Application, 'status' | 'prepare'>): boolean {
  return hasPrepareStep(application) && application.prepare === 'success';
}
