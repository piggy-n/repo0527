import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchMessages, markAllMessagesRead, markMessageRead } from './api';
import { approvalMessage, messagesResponse, resourceMessage, tableMessage } from './test-data';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('消息列表', () => {
  it('全部消息不带条件，未读的带 isRead: "false"；字符串的已读换成布尔，taskId 是申请 ID', async () => {
    const bodies: unknown[] = [];
    server.use(
      mock.post('/backend/api/message/list', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(messagesResponse([approvalMessage(), resourceMessage(), tableMessage()]));
      })
    );
    const messages = await fetchMessages(false);
    await fetchMessages(true);

    expect(bodies).toEqual([{}, { isRead: 'false' }]);
    expect(messages).toEqual([
      {
        id: 'msg-approval',
        category: 'approval',
        title: '数据申请待审核',
        content: '王立于2026年10月28日11时29分提交的资源申请需要您审批，请及时查看并处理相关申请。',
        createdAt: '2026-10-28 11:29:36',
        read: false,
        applyId: 'apply-pending'
      },
      {
        id: 'msg-resource',
        category: 'resource',
        title: '数据准备完成',
        content: '您于2026年10月25日14时20分提交的资源数据已处理完成。',
        createdAt: '2026-10-25 14:52:27',
        read: true,
        applyId: 'apply-ready'
      },
      {
        id: 'msg-table',
        category: 'table',
        title: '报表分析通知',
        content: '基本统计报表_区级',
        createdAt: '2026-10-14 14:28:00',
        read: false,
        applyId: null
      }
    ]);
  });

  it('没见过的类型或已读值按返回格式错误处理', async () => {
    server.use(
      mock.post('/backend/api/message/list', () => HttpResponse.json(messagesResponse([approvalMessage({ isRead: '1' })])))
    );
    await expect(fetchMessages(false)).rejects.toMatchObject({ kind: 'invalid-response' });
    server.use(
      mock.post('/backend/api/message/list', () => HttpResponse.json(messagesResponse([tableMessage({ category: 'notice' })])))
    );
    await expect(fetchMessages(false)).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});

describe('已读', () => {
  it('一条：ID 编码进路径、没有正文；全部：没有正文', async () => {
    const received: { path: string; body: string }[] = [];
    server.use(
      mock.post('/backend/api/message/read/*', async ({ request }) => {
        received.push({ path: new URL(request.url).pathname, body: await request.text() });
        return HttpResponse.json({ success: true, code: 200, msg: '请求成功', data: null });
      })
    );
    await markMessageRead('msg / 1');
    await markAllMessagesRead();

    expect(received).toEqual([
      { path: '/backend/api/message/read/msg%20%2F%201', body: '' },
      { path: '/backend/api/message/read/all', body: '' }
    ]);
  });

  it('失败时保留服务端的原因', async () => {
    server.use(
      mock.post('/backend/api/message/read/:id', () => HttpResponse.json({ success: false, code: 500, msg: '消息不存在' }))
    );
    await expect(markMessageRead('msg-1')).rejects.toMatchObject({ kind: 'business', message: '消息不存在' });
  });
});
