export type MessageCategory = 'approval' | 'resource' | 'table';
export type MessageStatus = 'pending' | 'approved' | 'rejected' | 'info';

/** 仅供布局确认的本地消息，不作为接口响应类型 */
export interface PreviewMessage {
  id: number;
  title: string;
  content: string;
  time: string;
  category: MessageCategory;
  status: MessageStatus;
  read: boolean;
}

export const categoryLabels: Record<MessageCategory, string> = {
  approval: '审批提醒',
  resource: '资源消息',
  table: '统计报表'
};

// 标题、正文、状态和时间覆盖不同长度，所有内容均为演示数据
const samples: Omit<PreviewMessage, 'id'>[] = [
  {
    title: '资源申请待审核',
    content: '南京市 2025 年度地类图斑数据申请已提交，请查看申请范围、用途及接收单位后进行审核。',
    time: '2026-10-23 10:32',
    category: 'approval',
    status: 'pending',
    read: false
  },
  {
    title: '报表分析已完成',
    content: '基本变化统计报表（省级）已生成，可在统计报表中查看并下载。',
    time: '2026-10-23 10:18',
    category: 'table',
    status: 'info',
    read: false
  },
  {
    title: '资源申请审核通过',
    content: '您申请的无锡市 2025 年度自然资源调查成果已通过审核，数据正在准备中。',
    time: '2026-10-23 09:46',
    category: 'resource',
    status: 'approved',
    read: false
  },
  {
    title: '资源申请未通过审核',
    content: '苏州市建设用地调查成果申请未通过审核。申请用途说明不完整，请补充项目名称、使用范围和成果保管要求后重新申请。',
    time: '2026-10-22 16:20',
    category: 'resource',
    status: 'rejected',
    read: false
  },
  {
    title: '跨年度自然资源调查监测成果汇总统计报表已生成',
    content: '江苏省 2020—2025 年自然资源调查监测成果汇总统计报表已生成，包含各市、县级统计信息。',
    time: '2026-10-22 15:08',
    category: 'table',
    status: 'info',
    read: true
  },
  {
    title: '资源数据已准备好',
    content: '徐州市地类图斑数据已准备就绪，可进入对应申请查看数据准备情况并下载。',
    time: '2026-10-21 11:12',
    category: 'resource',
    status: 'approved',
    read: true
  }
];

/** 足量记录用于检查内部滚动和加载更多，不持久化 */
export function createPreviewMessages(): PreviewMessage[] {
  return Array.from({ length: 24 }, (_, index) => {
    const sample = samples[index % samples.length];
    const day = 20 - Math.floor(index / samples.length);
    const hour = 18 - index % samples.length;
    return {
      ...sample,
      id: index + 1,
      time: index < samples.length ? sample.time : `2026-10-${day} ${hour}:00`,
      read: index >= samples.length || sample.read
    };
  });
}
