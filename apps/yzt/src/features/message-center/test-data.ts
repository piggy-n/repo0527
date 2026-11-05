// 测试用的虚构消息，字段结构按 2026-10-27 实测接口：每条记录都有同一组键，没有值的是 null
import { HttpResponse, http as mock } from 'msw';

type RawMessage = Record<string, unknown>;

const base = {
  pageNum: null,
  pageSize: null,
  priority: 0,
  readTime: null,
  remark: null,
  senderId: null,
  senderName: null,
  taskId: null,
  taskStatus: null,
  userDeptCode: 'jsdxzx',
  userDeptName: '江苏省基础地理信息中心',
  userId: 'user-1',
  userName: '王立'
};

/** 审批提醒：taskId 是申请的 apply_id */
export function approvalMessage(overrides: RawMessage = {}): RawMessage {
  return {
    ...base,
    msgId: 'msg-approval',
    category: 'approval',
    title: '数据申请待审核',
    content: '王立于2026年10月28日11时29分提交的资源申请需要您审批，请及时查看并处理相关申请。',
    createTime: '2026-10-28 11:29:36',
    isRead: 'false',
    taskId: 'apply-pending',
    taskStatus: 'pending',
    ...overrides
  };
}

export function resourceMessage(overrides: RawMessage = {}): RawMessage {
  return {
    ...base,
    msgId: 'msg-resource',
    category: 'resource',
    title: '数据准备完成',
    content: '您于2026年10月25日14时20分提交的资源数据已处理完成。',
    createTime: '2026-10-25 14:52:27',
    isRead: 'true',
    readTime: '2026-10-26 09:00:00',
    taskId: 'apply-ready',
    taskStatus: 'approved',
    ...overrides
  };
}

/** 报表通知：taskId 是 null */
export function tableMessage(overrides: RawMessage = {}): RawMessage {
  return {
    ...base,
    msgId: 'msg-table',
    category: 'table',
    title: '报表分析通知',
    content: '基本统计报表_区级',
    createTime: '2026-10-14 14:28:00',
    isRead: 'false',
    senderId: 'user-1',
    senderName: 'admin',
    ...overrides
  };
}

/** 成功的信封：data 直接是消息数组 */
export function messagesResponse(list: RawMessage[]) {
  return { success: true, code: 200, msg: '请求成功', data: list };
}

// 挂起一个请求，把继续的函数放进队列
const hold = (queue: (() => void)[]) =>
  new Promise<void>(resolve => {
    queue.push(resolve);
  });

export interface MessageBackendOptions {
  messages?: RawMessage[];
  holdLists?: boolean;
  holdRead?: boolean;
  failLists?: boolean;
  failRead?: boolean;
}

/**
 * 模拟消息接口：按 isRead 记录每条消息，已读接口改它；requests 按顺序记下每次请求。
 * holdLists 为 true 时列表请求挂起，用例调用 lists 里的函数才返回（拿到的是返回那一刻的数据）；holdRead 同理，管两个已读接口。
 * 选项放在 control 里，用例中途可以改
 */
export function createMessageBackend({
  messages = [approvalMessage(), resourceMessage(), tableMessage()],
  holdLists = false,
  holdRead = false,
  failLists = false,
  failRead = false
}: MessageBackendOptions = {}) {
  const requests: string[] = [];
  const lists: (() => void)[] = [];
  const reads: (() => void)[] = [];
  const control = { holdLists, holdRead, failLists, failRead };
  const handlers = [
    mock.post('/backend/api/message/list', async ({ request }) => {
      const body = (await request.json()) as { isRead?: string };
      const unreadOnly = body.isRead === 'false';
      requests.push(unreadOnly ? 'unread' : 'list');
      if (control.holdLists) {
        await hold(lists);
      }
      if (control.failLists) {
        return HttpResponse.json({ success: false, code: 500, msg: '服务异常' });
      }
      const rows = unreadOnly ? messages.filter(message => message.isRead === 'false') : messages;
      return HttpResponse.json(messagesResponse(structuredClone(rows)));
    }),
    mock.post('/backend/api/message/read/all', async () => {
      requests.push('read all');
      if (control.holdRead) {
        await hold(reads);
      }
      for (const message of messages) {
        message.isRead = 'true';
      }
      return HttpResponse.json(messagesResponse([]));
    }),
    mock.post('/backend/api/message/read/:id', async ({ params }) => {
      requests.push(`read ${String(params.id)}`);
      if (control.holdRead) {
        await hold(reads);
      }
      if (control.failRead) {
        return HttpResponse.json({ success: false, code: 500, msg: '消息不存在' });
      }
      const target = messages.find(message => message.msgId === params.id);
      if (target) {
        target.isRead = 'true';
      }
      return HttpResponse.json(messagesResponse([]));
    })
  ];

  // 模拟弹框关着时到达的新消息
  const arrive = () => {
    messages.unshift(approvalMessage({ msgId: 'msg-new', title: '新的申请' }));
  };
  return { handlers, requests, lists, reads, control, arrive };
}
