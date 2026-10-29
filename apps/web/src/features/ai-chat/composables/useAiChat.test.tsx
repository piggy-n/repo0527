import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import { aiChatKeys } from '../queries';
import { chatResultBody, sseLine, sseResponse } from '../test-data';
import { useAiChat } from './useAiChat';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

let created: ReturnType<typeof useAiChat> | undefined;

const Host = defineComponent({
  setup() {
    created = useAiChat();
    return () => null;
  }
});

function mountHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(Host, { global: { plugins: [createPinia(), [VueQueryPlugin, { queryClient }]] } });
  return { wrapper, queryClient, chat: required(created, 'useAiChat 的返回值') };
}

// 记录请求次数；挂起的请求直到用例结束都不返回
function countRequests(path: string, respond: () => Response | Promise<Response>, method: 'get' | 'post' = 'post') {
  const calls: unknown[] = [];
  server.use(
    mock[method](path, async ({ request }) => {
      calls.push(method === 'post' ? await request.json() : request.url);
      return respond();
    })
  );
  return calls;
}

const hang = () => new Promise<Response>(() => undefined);

// 等一个应当结束的 Promise：没有结束时以断言失败（vi.waitFor 的期限），不会一直挂起到用例超时
async function expectSettled(promise: Promise<unknown>) {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  await vi.waitFor(() => expect(settled).toBe(true));
}

describe('useAiChat', () => {
  it('流式回答：步骤、正文逐步更新，done 后保留流式的正文，结果交给页面并让历史失效', async () => {
    countRequests('/ai-backend/api/chat/stream', () =>
      sseResponse([
        sseLine({ type: 'tool_start', name: 'spatial_breakdown', input: {} }),
        sseLine({ type: 'tool_end', name: 'spatial_breakdown', output: '"success": true' }),
        sseLine({ type: 'token', content: '南京市' }),
        sseLine({ type: 'token', content: '耕地' }),
        sseLine({ type: 'done', ...chatResultBody({ answer: '完整回答' }) })
      ])
    );
    const { chat, queryClient } = mountHost();
    queryClient.setQueryData(aiChatKeys.sessions(), []);

    await chat.send('  南京市耕地  ');

    const [question, answer] = chat.messages.value;
    expect(question).toMatchObject({ role: 'user', content: '南京市耕地' });
    expect(answer).toMatchObject({
      role: 'assistant',
      content: '南京市耕地',
      pending: false,
      live: true,
      error: null,
      hasChart: true,
      hasMap: false,
      stats: { durationMs: 964931, tokenCount: 981, tps: 1 }
    });
    // done 带的步骤替换流式过程中记下的
    expect(answer?.steps.map(step => step.name)).toEqual(['spatial_breakdown']);
    expect(chat.latest.value?.question).toBe('南京市耕地');
    expect(chat.sending.value).toBe(false);
    expect(queryClient.getQueryState(aiChatKeys.sessions())?.isInvalidated).toBe(true);
  });

  it('流式请求没被接受时改用同步接口，问题和会话 ID 相同', async () => {
    const streamed = countRequests('/ai-backend/api/chat/stream', () => new HttpResponse(null, { status: 404 }));
    const posted = countRequests('/ai-backend/api/chat', () => HttpResponse.json(chatResultBody()));
    const { chat } = mountHost();

    await chat.send('分类统计');

    expect(posted).toEqual(streamed);
    expect(chat.messages.value[1]).toMatchObject({ content: '江苏省2022年农用地分类统计结果如下', pending: false });
  });

  it('收到过事件后失败的不再重发，显示失败原因', async () => {
    countRequests('/ai-backend/api/chat/stream', () =>
      sseResponse([sseLine({ type: 'tool_start', name: 'query_layer', input: {} }), 'data: {不是 JSON\n'])
    );
    const posted = countRequests('/ai-backend/api/chat', () => HttpResponse.json(chatResultBody()));
    const { chat } = mountHost();

    await chat.send('分类统计');

    expect(posted).toEqual([]);
    expect(chat.messages.value[1]).toMatchObject({ pending: false, error: '服务返回的数据格式不正确' });
    // 回答结束时进行中的步骤按完成处理
    expect(chat.messages.value[1]?.steps[0]?.status).toBe('succeeded');
  });

  it('error 事件结束回答并记下原因；流读完没有 done 时同样结束', async () => {
    countRequests('/ai-backend/api/chat/stream', () => sseResponse([sseLine({ type: 'error', message: '模型超时' })]));
    const { chat } = mountHost();

    await chat.send('分类统计');

    expect(chat.messages.value[1]).toMatchObject({ pending: false, error: '模型超时', content: '' });
    expect(chat.latest.value).toBeNull();
  });

  it('同步接口也失败时显示失败原因', async () => {
    countRequests('/ai-backend/api/chat/stream', () => HttpResponse.error());
    countRequests('/ai-backend/api/chat', () => new HttpResponse(null, { status: 401 }));
    const { chat } = mountHost();

    await chat.send('分类统计');

    expect(chat.messages.value[1]).toMatchObject({ pending: false, error: 'AI 服务未登录或登录已过期' });
  });

  it('回答中不能再提问；新对话打断回答，换新的会话 ID 并清空结果', async () => {
    const streamed = countRequests('/ai-backend/api/chat/stream', hang);
    const { chat } = mountHost();
    const firstSession = chat.sessionId.value;

    const sending = chat.send('第一个问题');
    await chat.send('第二个问题');
    await flushPromises();
    expect(streamed).toHaveLength(1);
    expect(chat.messages.value).toHaveLength(2);

    chat.newSession();
    await expectSettled(sending);

    expect(chat.messages.value).toEqual([]);
    expect(chat.sending.value).toBe(false);
    expect(chat.sessionId.value).toMatch(/^[0-9a-f]{8}$/);
    expect(chat.sessionId.value).not.toBe(firstSession);
  });

  it('打开历史：打断进行中的回答，换成历史的消息，步骤收起', async () => {
    countRequests('/ai-backend/api/chat/stream', hang);
    countRequests(
      '/ai-backend/api/sessions/s-1/messages',
      () =>
        HttpResponse.json([
          { role: 'user', content: '南京市有哪些区', timestamp: '2026-10-27T08:00:00Z' },
          { role: 'assistant', content: '南京市有 11 个区', steps: [chatResultBody().steps[0]], duration_ms: 1200 }
        ]),
      'get'
    );
    const { chat } = mountHost();
    const sending = chat.send('分类统计');
    await flushPromises();

    await expect(chat.openSession('s-1')).resolves.toBe(true);
    await expectSettled(sending);

    expect(chat.sessionId.value).toBe('s-1');
    expect(chat.sending.value).toBe(false);
    expect(chat.messages.value.map(message => [message.role, message.content, message.live])).toEqual([
      ['user', '南京市有哪些区', false],
      ['assistant', '南京市有 11 个区', false]
    ]);
    expect(chat.messages.value[0]?.timestamp).toBe(Date.parse('2026-10-27T08:00:00Z'));
    expect(chat.messages.value[1]?.stats.durationMs).toBe(1200);
  });

  it('打开当前对话直接返回；打开失败时保留原来的对话', async () => {
    countRequests('/ai-backend/api/sessions/s-2/messages', () => new HttpResponse(null, { status: 500 }), 'get');
    const { chat } = mountHost();
    const current = chat.sessionId.value;

    await expect(chat.openSession(current)).resolves.toBe(true);
    await expect(chat.openSession('s-2')).resolves.toBe(false);

    expect(chat.sessionId.value).toBe(current);
    expect(chat.opening.value).toBeNull();
  });

  it('页面卸载时取消进行中的回答', async () => {
    let aborted = false;
    server.use(
      mock.post('/ai-backend/api/chat/stream', ({ request }) => {
        request.signal.addEventListener('abort', () => {
          aborted = true;
        });
        return hang();
      })
    );
    const { chat, wrapper } = mountHost();
    const sending = chat.send('分类统计');
    await flushPromises();

    wrapper.unmount();

    await expectSettled(sending);
    expect(aborted).toBe(true);
  });
});
