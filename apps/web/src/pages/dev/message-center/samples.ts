// 消息弹框原型的固定数据：字段按 2026-10-27 只读核对的真实接口整理（docs/migration.md），人名是虚构的。
// 真实接口一次返回全部消息（当时 505 条，497 条是报表通知），没有分页和未读数接口

export type MessageCategory = 'approval' | 'resource' | 'table';

export interface MessageSample {
  id: string;
  category: MessageCategory;
  title: string;
  content: string;
  // 接口给的是本地时间的字符串 YYYY-MM-DD HH:mm:ss
  createdAt: string;
  read: boolean;
  // 接口字段叫 taskId，实际是申请的 apply_id
  applyId?: string;
}

export const CATEGORY_LABELS: Record<MessageCategory, string> = {
  approval: '审批提醒',
  resource: '资源消息',
  table: '统计报表'
};

const REPORT_NAMES = [
  '基本统计报表_区级',
  '基本统计报表_市级',
  '基本统计报表_县级',
  '基本统计报表_省级',
  '汇总统计报表_市级',
  '汇总统计报表_省级',
  '基本变化统计报表_市级',
  '基本变化统计报表_省级',
  '基本变化统计报表_县级',
  '基本变化统计报表_区级'
];

const pad = (value: number) => String(value).padStart(2, '0');

const businessMessages: MessageSample[] = [
  {
    id: 'msg-approval-1',
    category: 'approval',
    title: '数据申请待审核',
    content: '王立于2026年10月28日11时29分提交的资源申请需要您审批，请及时查看并处理相关申请，避免影响项目进度。',
    createdAt: '2026-10-28 11:29:36',
    read: false,
    applyId: 'apply-001'
  },
  {
    id: 'msg-approval-2',
    category: 'approval',
    title: '数据申请待审核',
    content: '刘敏于2026年10月27日16时05分提交的资源申请需要您审批，请及时查看并处理相关申请，避免影响项目进度。',
    createdAt: '2026-10-27 16:05:12',
    read: true,
    applyId: 'apply-002'
  },
  {
    id: 'msg-resource-1',
    category: 'resource',
    title: '资源申请审批结果通知',
    content: '您于2026年10月22日08时56分提交的资源申请未通过审核：申请范围超出本处室职责，请由南京市局统一申请。',
    createdAt: '2026-10-22 17:40:00',
    read: false,
    applyId: 'apply-006'
  },
  {
    id: 'msg-resource-2',
    category: 'resource',
    title: '数据准备完成',
    content: '您于2026年10月25日14时20分提交的资源数据已处理完成，现在可以下载。',
    createdAt: '2026-10-25 14:52:27',
    read: false,
    applyId: 'apply-004'
  },
  {
    id: 'msg-resource-3',
    category: 'resource',
    title: '数据开始处理',
    content: '您于2026年10月25日14时20分提交的资源数据正在处理中。',
    createdAt: '2026-10-25 14:20:31',
    read: true,
    applyId: 'apply-004'
  },
  {
    id: 'msg-resource-4',
    category: 'resource',
    title: '资源申请审批结果通知',
    content: '您于2026年09月10日16时47分提交的资源申请已过期，如需该资源，请重新申请。',
    createdAt: '2026-09-10 23:00:00',
    read: false,
    applyId: 'apply-010'
  }
];

// 报表通知每次统计任务完成都会发一条，数量远多于业务消息
const reportMessages: MessageSample[] = Array.from({ length: 140 }, (_, index) => {
  const day = 14 - Math.floor(index / 12);
  const minute = 59 - (index % 12) * 4;
  return {
    id: `msg-table-${index + 1}`,
    category: 'table',
    title: '报表分析通知',
    content: REPORT_NAMES[index % REPORT_NAMES.length],
    createdAt: `2026-${day > 0 ? '10' : '09'}-${pad(day > 0 ? day : day + 30)} 14:${pad(minute)}:00`,
    read: index % 3 !== 0
  };
});

/** 按时间倒序，和接口一致 */
export const MESSAGE_SAMPLES: MessageSample[] = [...businessMessages, ...reportMessages].toSorted((a, b) =>
  b.createdAt.localeCompare(a.createdAt)
);
