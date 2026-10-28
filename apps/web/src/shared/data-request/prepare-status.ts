// 数据准备的状态：申请的 storage_status、统计报表的 status 是同一套取值（旧页面用同一个函数换算），
// 取值沿用旧页面的筛选项，实测只见过 timeout（docs/migration.md）

export const PREPARE_STATUSES = ['processing', 'success', 'timeout', 'failed'] as const;

export type PrepareStatus = (typeof PREPARE_STATUSES)[number];

export const PREPARE_STATUS_LABELS: Record<PrepareStatus, string> = {
  processing: '正在处理',
  success: '处理完成',
  timeout: '已过期',
  failed: '处理失败'
};

/** 有数据准备这一步、但还没有准备状态时的文案 */
export const PREPARE_WAITING_LABEL = '未开始处理';

/** 是不是认得的状态 */
export function isPrepareStatus(value: string): value is PrepareStatus {
  return PREPARE_STATUSES.some(status => status === value);
}
