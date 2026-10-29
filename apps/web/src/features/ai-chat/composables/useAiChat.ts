import { LatestController } from '@yzt/utils';
import { computed, onScopeDispose, shallowRef } from 'vue';
import { ApiError } from '@/shared/http/errors';
import { type AiSessionMessage, type ChatStreamEvent, fetchAiSessionMessages, postChat, streamChat } from '../api';
import { type AnswerStats, type ChatResult, EMPTY_STATS } from '../chat-result';
import { useInvalidateAiSessions } from '../queries';
import { finishStep, settleSteps, startStep, type ToolStep } from '../tool-steps';

export interface ChatMessage {
  /** 只在本页面内唯一，用作列表的 key */
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly timestamp: number;
  /** 正在回答 */
  readonly pending: boolean;
  readonly steps: readonly ToolStep[];
  /** 本次发出的回答步骤默认展开，打开的历史默认收起（沿用旧项目） */
  readonly live: boolean;
  readonly stats: AnswerStats;
  /** 回答失败的原因 */
  readonly error: string | null;
  /** 回答带有地图数据、图表，在消息下方标出 */
  readonly hasMap: boolean;
  readonly hasChart: boolean;
}

/** 最近一次回答的结果，交给页面的地图和结果区 */
export interface LatestAnswer {
  readonly question: string;
  readonly result: ChatResult;
}

// 会话 ID 沿用旧项目的 8 位十六进制，由前端生成，第一次提问时后端建立会话；
// 不用 randomUUID：它只在安全上下文可用，内网可能用 http 访问
function createSessionId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * AI 对话的拥有者：消息、当前会话和最近一次的结果。发送、打开历史、新对话在同一个通道里后发覆盖先发（ADR 0039）；
 * 不渲染、不提示，滚动、确认框由组件负责
 */
export function useAiChat() {
  const messages = shallowRef<readonly ChatMessage[]>([]);
  const sessionId = shallowRef(createSessionId());
  const sending = shallowRef(false);
  /** 正在打开的历史对话 */
  const opening = shallowRef<string | null>(null);
  const latest = shallowRef<LatestAnswer | null>(null);
  const invalidateSessions = useInvalidateAiSessions();
  const channel = new LatestController();
  onScopeDispose(() => channel[Symbol.dispose]());
  let nextId = 0;

  function message(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    nextId += 1;
    return {
      id: nextId,
      role,
      content,
      timestamp: Date.now(),
      pending: false,
      steps: [],
      live: true,
      stats: EMPTY_STATS,
      error: null,
      hasMap: false,
      hasChart: false,
      ...extra
    };
  }

  function update(id: number, change: (current: ChatMessage) => ChatMessage) {
    messages.value = messages.value.map(item => (item.id === id ? change(item) : item));
  }

  // 结束还在回答的消息：被新的操作打断、流读完却没有 done 时，进行中的步骤按完成处理
  function settle(current: ChatMessage, error: string | null = null): ChatMessage {
    return current.pending ? { ...current, pending: false, steps: settleSteps(current.steps), error } : current;
  }

  // 打断进行中的发送或打开，开始新的一次
  function interrupt(): AbortSignal {
    const signal = channel.next();
    messages.value = messages.value.map(item => settle(item));
    sending.value = false;
    opening.value = null;
    return signal;
  }

  function finishAnswer(id: number, question: string, result: ChatResult) {
    update(id, current => ({
      ...current,
      pending: false,
      // 流式输出过正文时保留已显示的内容（沿用旧项目），否则用结果里的回答
      content: current.content === '' ? result.answer : current.content,
      steps: result.steps.length > 0 ? result.steps : settleSteps(current.steps),
      stats: result.stats,
      hasMap: result.geojson !== null,
      hasChart: result.chart !== null
    }));
    latest.value = { question, result };
  }

  function applyEvent(id: number, question: string, event: ChatStreamEvent) {
    switch (event.type) {
      case 'tool_start':
        update(id, current => ({ ...current, steps: startStep(current.steps, event.name, event.input) }));
        break;
      case 'tool_end':
        update(id, current => ({
          ...current,
          steps: finishStep(current.steps, event.name, event.output, event.success)
        }));
        break;
      case 'token':
        update(id, current => ({
          ...current,
          content: current.content + event.content,
          stats: {
            ...current.stats,
            tokenCount: event.tokenCount ?? current.stats.tokenCount,
            durationMs: event.elapsedMs ?? current.stats.durationMs
          }
        }));
        break;
      case 'done':
        finishAnswer(id, question, event.result);
        break;
      case 'error':
        update(id, current => settle(current, event.message));
        break;
    }
  }

  /** 提问：先用流式接口，连接建立不起来（还没收到任何事件）时改用同步接口；正在回答时不能再提问 */
  async function send(text: string): Promise<void> {
    const question = text.trim();
    if (question === '' || sending.value) {
      return;
    }
    const signal = interrupt();
    const answer = message('assistant', '', { pending: true });
    messages.value = [...messages.value, message('user', question), answer];
    sending.value = true;
    const input = { message: question, sessionId: sessionId.value };

    let received = false;
    try {
      try {
        await streamChat(input, signal, event => {
          received = true;
          applyEvent(answer.id, question, event);
        });
      } catch (error) {
        // 只在请求没被接受（连不上、状态码出错）时重发；收到过事件或返回的格式不对时不再重发，否则同一个问题会在会话里记两次
        const rejected = error instanceof ApiError && error.kind !== 'invalid-response';
        if (received || signal.aborted || !rejected) {
          throw error;
        }
        const result = await postChat(input, signal);
        if (!signal.aborted) {
          finishAnswer(answer.id, question, result);
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        update(answer.id, current => settle(current, error instanceof ApiError ? error.message : '服务异常'));
      }
      if (!(error instanceof ApiError)) {
        throw error;
      }
    } finally {
      // 被新的操作打断时，状态已由打断的一方处理
      if (!signal.aborted) {
        update(answer.id, current => settle(current));
        sending.value = false;
        void invalidateSessions();
      }
    }
  }

  function historyMessage(record: AiSessionMessage): ChatMessage {
    const time = record.timestamp === undefined ? Number.NaN : Date.parse(record.timestamp);
    return message(record.role, record.content, {
      timestamp: Number.isNaN(time) ? Date.now() : time,
      steps: record.steps ?? [],
      live: false,
      stats: { durationMs: record.duration_ms ?? 0, tokenCount: record.token_count ?? 0, tps: record.tps ?? 0 }
    });
  }

  /** 打开历史对话，返回是否已打开（是当前对话时直接返回 true）；失败原因由全局提示显示 */
  async function openSession(id: string): Promise<boolean> {
    if (id === sessionId.value) {
      return true;
    }
    const signal = interrupt();
    opening.value = id;
    try {
      const records = await fetchAiSessionMessages(id, signal);
      if (signal.aborted) {
        return false;
      }
      messages.value = records.map(historyMessage);
      sessionId.value = id;
      latest.value = null;
      return true;
    } catch (error) {
      if (error instanceof ApiError) {
        return false;
      }
      throw error;
    } finally {
      if (!signal.aborted) {
        opening.value = null;
      }
    }
  }

  /** 新对话：打断进行中的回答，清空消息和结果 */
  function newSession() {
    interrupt();
    messages.value = [];
    sessionId.value = createSessionId();
    latest.value = null;
  }

  return {
    messages,
    sessionId,
    sending,
    opening,
    latest,
    /** 最近一次回答的耗时与用量 */
    latestStats: computed(() => latest.value?.result.stats ?? EMPTY_STATS),
    send,
    openSession,
    newSession
  };
}

export type AiChat = ReturnType<typeof useAiChat>;
