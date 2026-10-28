import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount, type VueWrapper } from '@vue/test-utils';
import { ElMessage, ElMessageBox, type MessageBoxData } from 'element-plus';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { configureHttp, type HttpHooks } from '@/shared/http/configure';
import { required } from '@/shared/testing/required';
import type { AiSession } from '../api';
import { type AiChat, useAiChat } from '../composables/useAiChat';
import { chatResultBody, sseLine, sseResponse } from '../test-data';
import { ChatPanel } from './ChatPanel';

const server = setupServer();
const onError = vi.fn<NonNullable<HttpHooks['onError']>>();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  configureHttp({});
  onError.mockReset();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = '';
});

afterAll(() => {
  server.close();
});

let chat: AiChat | undefined;

const Host = defineComponent({
  setup() {
    const owner = useAiChat();
    chat = owner;
    return () => <ChatPanel chat={owner} />;
  }
});

function mountPanel() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3_600_000),
    user: { loginName: 'zhangsan', role: Role.user }
  });
  configureHttp({ onError });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(Host, { attachTo: document.body, global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
  return { wrapper, chat: required(chat, 'useAiChat 的返回值') };
}

// 流式回答：收到的问题记下来，直接给出完整结果
function answerByStream() {
  const questions: string[] = [];
  server.use(
    mock.post('/ai-backend/api/chat/stream', async ({ request }) => {
      const body = await request.json();
      questions.push(body && typeof body === 'object' && 'message' in body ? String(body.message) : '');
      return sseResponse([sseLine({ type: 'done', ...chatResultBody({ answer: '**南京市**有 11 个区' }) })]);
    })
  );
  return questions;
}

const session = (id: string, title: string): AiSession => ({
  session_id: id,
  title,
  message_count: 4,
  last_time: new Date().toISOString(),
  duration_ms: 2300
});

function textarea(wrapper: VueWrapper) {
  return wrapper.get('textarea');
}

const buttonByText = (wrapper: VueWrapper, text: string) =>
  required(
    wrapper.findAll('button').find(button => button.text() === text),
    `"${text}"按钮`
  );

describe('ChatPanel', () => {
  it('回车发送并清空输入；Shift + 回车、输入法选字时不发送', async () => {
    const questions = answerByStream();
    const { wrapper } = mountPanel();
    await textarea(wrapper).setValue('南京市有哪些区');

    await textarea(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true });
    await textarea(wrapper).trigger('keydown', { key: 'Enter', isComposing: true });
    // 发送时会同步清空输入，请求要晚几轮才到
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('南京市有哪些区');
    expect(questions).toEqual([]);

    await textarea(wrapper).trigger('keydown', { key: 'Enter' });
    await vi.waitFor(() => expect(wrapper.find('[data-role="assistant"] strong').exists()).toBe(true));

    expect(questions).toEqual(['南京市有哪些区']);
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('');
    // 回答的 Markdown 渲染成 HTML，下方显示用量和图表标记
    expect(wrapper.get('[data-role="assistant"] strong').text()).toBe('南京市');
    expect(wrapper.get('[data-role="assistant"]').text()).toContain('964.9s · 981 tokens · 1 tok/s');
    expect(wrapper.get('[data-role="assistant"]').text()).toContain('图表');
  });

  it('点快捷提问直接发送', async () => {
    const questions = answerByStream();
    const { wrapper } = mountPanel();
    const chip = required(wrapper.find('[aria-label="快捷提问"] button:not([aria-label])'), '快捷提问');

    await chip.trigger('click');

    await vi.waitFor(() => expect(questions).toEqual([chip.text()]));
  });

  it('历史对话加载失败：显示失败状态和重试，不弹全局提示', async () => {
    let requests = 0;
    server.use(
      mock.get('/ai-backend/api/sessions', () => {
        requests += 1;
        return requests === 1 ? new HttpResponse(null, { status: 502 }) : HttpResponse.json([]);
      })
    );
    const { wrapper } = mountPanel();

    await buttonByText(wrapper, '历史').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('历史对话加载失败'));
    expect(onError).not.toHaveBeenCalled();
    // 没有历史时不能删除全部
    expect(buttonByText(wrapper, '删除全部').attributes('disabled')).toBeDefined();

    await buttonByText(wrapper, '重试').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无历史对话'));
  });

  it('打开历史对话后回到对话视图', async () => {
    server.use(
      mock.get('/ai-backend/api/sessions', () => HttpResponse.json([session('s-1', '南京市耕地面积')])),
      mock.get('/ai-backend/api/sessions/s-1/messages', () =>
        HttpResponse.json([
          { role: 'user', content: '南京市耕地面积' },
          { role: 'assistant', content: '约 280 万亩' }
        ])
      )
    );
    const { wrapper, chat: owner } = mountPanel();
    await buttonByText(wrapper, '历史').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('南京市耕地面积'));
    expect(wrapper.text()).toContain('今天');
    expect(wrapper.text()).toContain('4 条消息');

    await required(wrapper.find('button[aria-current], li button'), '历史对话').trigger('click');

    await vi.waitFor(() => expect(wrapper.find('textarea').exists()).toBe(true));
    expect(owner.sessionId.value).toBe('s-1');
    expect(wrapper.text()).toContain('约 280 万亩');
  });

  it('确认后删除当前对话：提示成功并开始新对话', async () => {
    const deleted: string[] = [];
    server.use(
      mock.get('/ai-backend/api/sessions', () => HttpResponse.json([session('s-1', '南京市耕地面积')])),
      mock.get('/ai-backend/api/sessions/s-1/messages', () => HttpResponse.json([])),
      mock.delete('/ai-backend/api/sessions/:id', ({ params }) => {
        deleted.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      })
    );
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const success = vi.spyOn(ElMessage, 'success');
    const { wrapper, chat: owner } = mountPanel();
    await owner.openSession('s-1');
    await buttonByText(wrapper, '历史').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[aria-label^="删除"]').exists()).toBe(true));

    await wrapper.get('[aria-label^="删除"]').trigger('click');

    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('历史对话已删除'));
    expect(confirm).toHaveBeenCalledWith('确认删除该历史对话？删除后不可恢复。', '删除历史对话', expect.anything());
    expect(deleted).toEqual(['s-1']);
    expect(owner.sessionId.value).not.toBe('s-1');
  });

  it('取消确认时不删除', async () => {
    const deleted: string[] = [];
    server.use(
      mock.get('/ai-backend/api/sessions', () => HttpResponse.json([session('s-1', '南京市耕地面积')])),
      mock.delete('/ai-backend/api/sessions', () => {
        deleted.push('all');
        return new HttpResponse(null, { status: 204 });
      })
    );
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
    const { wrapper } = mountPanel();
    await buttonByText(wrapper, '历史').trigger('click');
    await vi.waitFor(() => expect(buttonByText(wrapper, '删除全部').attributes('disabled')).toBeUndefined());

    await buttonByText(wrapper, '删除全部').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(deleted).toEqual([]);
  });
});
