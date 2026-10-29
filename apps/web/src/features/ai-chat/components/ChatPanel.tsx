import { ArrowLeft, Clock, Delete, Plus, Promotion } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElInput, ElMessage, ElMessageBox } from 'element-plus';
import { defineComponent, onBeforeUnmount, type PropType, ref } from 'vue';
import { statsText } from '../chat-result';
import type { AiChat } from '../composables/useAiChat';
import { useAiSessionRemoval } from '../composables/useAiSessionRemoval';
import { useAiSessionsQuery } from '../queries';
import { ChatConversation } from './ChatConversation';
import { ChatHistory } from './ChatHistory';
import styles from './ChatPanel.module.scss';

/** AI 对话面板：对话和历史两个视图共用一个面板，对话视图底部是输入框 */
export const ChatPanel = defineComponent({
  name: 'ChatPanel',
  props: {
    chat: { type: Object as PropType<AiChat>, required: true }
  },
  setup(props) {
    const historyOpen = ref(false);
    const sessionsQuery = useAiSessionsQuery(historyOpen);
    const removal = useAiSessionRemoval();
    const draft = ref('');

    // 确认框不随组件卸载关闭，卸载时关掉自己打开的
    let openConfirms = 0;
    onBeforeUnmount(() => {
      if (openConfirms > 0) {
        ElMessageBox.close();
      }
    });

    async function confirm(title: string, message: string): Promise<boolean> {
      openConfirms += 1;
      try {
        await ElMessageBox.confirm(message, title, { type: 'warning', confirmButtonText: '删除' });
        return true;
      } catch {
        // 点了取消、关闭，或页面销毁时被关闭
        return false;
      } finally {
        openConfirms -= 1;
      }
    }

    const closeHistory = () => {
      historyOpen.value = false;
    };

    async function openSession(sessionId: string) {
      if (await props.chat.openSession(sessionId)) {
        closeHistory();
      }
    }

    async function removeSession(sessionId: string) {
      const removed = await removal.remove(sessionId, () =>
        confirm('删除历史对话', '确认删除该历史对话？删除后不可恢复。')
      );
      if (!removed) {
        return;
      }
      ElMessage.success('历史对话已删除');
      if (sessionId === props.chat.sessionId.value) {
        props.chat.newSession();
      }
    }

    async function removeAll() {
      if (await removal.removeAll(() => confirm('删除全部历史对话', '确认删除全部历史对话？删除后不可恢复。'))) {
        ElMessage.success('历史对话已清空');
        props.chat.newSession();
      }
    }

    const startNewSession = () => {
      props.chat.newSession();
      closeHistory();
    };

    function submit() {
      const text = draft.value.trim();
      if (text === '' || props.chat.sending.value) {
        return;
      }
      draft.value = '';
      void props.chat.send(text);
    }

    // 回车发送，Shift + 回车换行；输入法选字时的回车不发送
    function onKeydown(event: Event | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    }

    const renderHistoryHeader = () => (
      <div class={styles.historyHeader}>
        <ElButton link icon={ArrowLeft} aria-label="返回对话" onClick={closeHistory} />
        <MxTitle level="panel">历史对话</MxTitle>
      </div>
    );

    const renderActions = () => {
      if (historyOpen.value) {
        const sessions = sessionsQuery.data.value;
        return [
          <ElButton
            link
            icon={Delete}
            disabled={!sessions?.length || removal.clearing.value}
            loading={removal.clearing.value}
            onClick={() => void removeAll()}
          >
            删除全部
          </ElButton>
        ];
      }
      return [
        <ElButton link icon={Clock} onClick={() => (historyOpen.value = true)}>
          历史
        </ElButton>,
        <ElButton link icon={Plus} onClick={() => props.chat.newSession()}>
          新对话
        </ElButton>
      ];
    };

    const renderInput = () => {
      const sending = props.chat.sending.value;
      const usage = statsText(props.chat.latestStats.value);
      return (
        <div class={styles.input}>
          <div class={styles.composer}>
            <ElInput
              type="textarea"
              modelValue={draft.value}
              onUpdate:modelValue={(value: string) => (draft.value = value)}
              autosize={{ minRows: 1, maxRows: 4 }}
              resize="none"
              placeholder="询问空间查询或统计信息"
              disabled={sending}
              aria-label="输入问题"
              onKeydown={onKeydown}
            />
            <ElButton
              type="primary"
              circle
              icon={Promotion}
              loading={sending}
              disabled={draft.value.trim() === ''}
              aria-label="发送"
              onClick={submit}
            />
          </div>
          <div class={styles.tips}>
            <span>会话 {props.chat.sessionId.value}</span>
            {usage !== '' && <span>{usage}</span>}
          </div>
        </div>
      );
    };

    return () => (
      <MxPanel
        headerTone="muted"
        flush
        title={historyOpen.value ? undefined : '空间查询助手'}
        description="自然资源 GIS 智能查询"
      >
        {{
          header: historyOpen.value ? renderHistoryHeader : undefined,
          actions: renderActions,
          default: () => [
            historyOpen.value ? (
              <ChatHistory
                sessions={sessionsQuery.data.value}
                loading={sessionsQuery.isPending.value}
                failed={sessionsQuery.isError.value}
                currentId={props.chat.sessionId.value}
                openingId={props.chat.opening.value}
                isRemoving={removal.isRemoving}
                onOpen={id => void openSession(id)}
                onRemove={id => void removeSession(id)}
                onRetry={() => void sessionsQuery.refetch()}
                onNewSession={startNewSession}
              />
            ) : (
              <ChatConversation chat={props.chat} />
            )
          ],
          footer: historyOpen.value ? undefined : renderInput
        }}
      </MxPanel>
    );
  }
});
