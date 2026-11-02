// 数据准备的状态：取值是申请的 storage_status，沿用旧页面的筛选项（docs/migration.md）；
// 统计报表的状态是中文文字，由它的接口换算成这几个值（features/statistics-report/api.ts）

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
