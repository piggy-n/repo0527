import { PREPARE_STATUS_LABELS, PREPARE_STATUSES } from '@/shared/data-request/prepare-status';
import type { Application, AuditStatus } from './api';

// 旧页面管理员看到的"申核通过"是错别字，统一为"审核"（ADR 0092）
export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = {
  pending: '待审核',
  approved: '审核通过',
  rejected: '审核不通过'
};

/** 筛选栏的选项，顺序和旧页面一致 */
export const AUDIT_STATUS_OPTIONS = (['pending', 'approved', 'rejected'] as const).map(value => ({
  value,
  label: AUDIT_STATUS_LABELS[value]
}));

export const PREPARE_STATUS_OPTIONS = PREPARE_STATUSES.map(value => ({
  value,
  label: PREPARE_STATUS_LABELS[value]
}));

/** 审核时打开申请的按钮：待审核的是"审核"，其余"查看"；只查看时不用它，用表格默认的"查看" */
export function auditOpenLabel(application: Pick<Application, 'status'>): string {
  return application.status === 'pending' ? '审核' : '查看';
}

/** 只有审核通过的申请和统计任务才准备数据 */
export function hasPrepareStep(application: Pick<Application, 'status'>): boolean {
  return application.status === 'approved' || application.status === 'table';
}

/** 数据准备完成才能下载 */
export function canDownload(application: Pick<Application, 'status' | 'prepare'>): boolean {
  return hasPrepareStep(application) && application.prepare === 'success';
}
