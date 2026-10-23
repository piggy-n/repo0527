import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchMessages, markMessagesRead } from './api';
import { messageFixture } from './testing';

const server = setupServer();
const success = (data: unknown) => HttpResponse.json({ code: 200, data });
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('消息接口', () => {
  it('按真实数组契约读取，转换字符串已读标识并按时间倒序，不发送虚构分页参数', async () => {
    let body: unknown;
    server.use(mock.post('/backend/api/message/list', async ({ request }) => {
      body = await request.json();
      return success([
        { ...messageFixture, msgId: 'old', createTime: '2026-10-22 12:00:00', isRead: 'true', taskId: null },
        { ...messageFixture, taskStatus: null }
      ]);
    }));
    const messages = await fetchMessages(new AbortController().signal);
    expect(body).toEqual({});
    expect(messages.map(message => [message.msgId, message.isRead])).toEqual([['message-1', false], ['old', true]]);
    expect(messages[0]?.taskStatus).toBeNull();
    expect(messages[1]?.taskId).toBeNull();
  });

  it.each([
    { list: [messageFixture] },
    [{ ...messageFixture, isRead: true }],
    [{ ...messageFixture, msgId: '' }],
    [{ ...messageFixture, category: 'unconfirmed' }]
  ])('不猜测或放宽未确认的返回结构：%j', async data => {
    server.use(mock.post('/backend/api/message/list', () => success(data)));
    await expect(fetchMessages(new AbortController().signal)).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('单条 ID 编码后写入，全部已读使用独立地址，失败保留业务错误', async () => {
    const urls: string[] = [];
    server.use(mock.post('/backend/api/message/read/:id', ({ request }) => {
      urls.push(new URL(request.url).pathname);
      return success(null);
    }));
    await markMessagesRead('a/b');
    await markMessagesRead();
    expect(urls).toEqual(['/backend/api/message/read/a%2Fb', '/backend/api/message/read/all']);
    server.use(mock.post('/backend/api/message/read/all', () => HttpResponse.json({ code: 500, msg: '写入失败' })));
    await expect(markMessagesRead()).rejects.toMatchObject({ kind: 'business', message: '写入失败' });
  });

  it('取消的读取不会发出请求', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchMessages(controller.signal)).rejects.toMatchObject({ kind: 'canceled' });
  });
});
