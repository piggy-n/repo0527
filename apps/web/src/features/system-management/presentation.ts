import type { SystemDownloadTarget, SystemRow } from './api';

export const auditLabels = {
  pending: '待审核',
  approved: '审核通过',
  rejected: '审核不通过',
  table: '审核通过'
};
export const auditTypes = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  table: 'success'
} as const;
export const taskLabels: Readonly<Record<string, string>> = {
  waiting: '待处理',
  processing: '处理中',
  success: '处理完成',
  timeout: '已过期',
  failed: '处理失败'
};

/** 未知准备状态保留原值，不猜测为等待或成功；没有状态时为空，表格里由全局样式显示"-" */
export function taskLabel(status: string | null | undefined): string {
  return status ? (taskLabels[status] ?? status) : '';
}

export const rowId = (row: SystemRow): string => row.kind === 'audit' ? row.apply_id : row.id;
export const rowName = (row: SystemRow): string => row.kind === 'audit' ? row.apply_name : row.name;

/** 审核通过且准备完成才开放申请下载，报表只要求准备完成 */
export function canDownload(row: SystemRow): boolean {
  if (row.kind === 'reports') {
    return row.status === 'success';
  }
  return (row.status === 'approved' || row.status === 'table') && row.storage_status === 'success';
}

export function downloadTarget(row: SystemRow): SystemDownloadTarget {
  return { id: `${row.kind}:${rowId(row)}`, recordId: rowId(row), name: rowName(row), section: row.kind };
}
