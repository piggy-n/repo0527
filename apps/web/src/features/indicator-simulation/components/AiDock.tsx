import { Promotion, RefreshRight } from '@element-plus/icons-vue';
import { ElButton, ElMessage } from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import { ChatAvatar } from '@/shared/chat-avatar/ChatAvatar';
import type { PromptComposer, SendOutcome } from '../composables/usePromptComposer';
import type { RunConversation } from '../composables/useRunConversation';
import styles from './AiDock.module.scss';

const WARNINGS: Readonly<Record<Exclude<SendOutcome, 'sent'>, string>> = {
  empty: '请输入计算指令，按 Tab 可以填入示例',
  unrecognized: '没有识别出监测指标，可以点"换一批"换个示例'
};

/**
 * 页面底部的 AI 对话栏：条件配置时写计算指令（换一批换示例、发送后 AI 逐个节点配置）；计算和结果阶段对计算说话，
 * 上方是按当前条件给的快捷说法；看结果时左侧没有时间线，AI 的回复写在输入框下面。
 * 输入框空着时占位显示一句完整的示例，按 Tab 填进来；回车发送（输入法选字时不算），Shift + 回车换行，
 * 输入框随内容（空着时随示例）长到三行
 */
export const AiDock = defineComponent({
  name: 'AiDock',
  props: {
    composer: { type: Object as PropType<PromptComposer>, required: true },
    /** 计算和结果阶段的对话；条件配置时为 null */
    conversation: { type: Object as PropType<RunConversation | null>, default: null }
  },
  setup(props) {
    const text = computed(() => (props.conversation ? props.conversation.text.value : props.composer.text.value));
    const example = computed(() =>
      props.conversation ? props.conversation.example.value : props.composer.example.value
    );
    const busy = computed(() => props.conversation === null && props.composer.sending.value);

    const say = (words?: string) => {
      const { conversation, composer } = props;
      if (!conversation) {
        const outcome = composer.send();
        if (outcome !== 'sent') {
          ElMessage.warning(WARNINGS[outcome]);
        }
        return;
      }
      const outcome = conversation.send(words);
      if (outcome === 'empty') {
        ElMessage.warning('请输入要说的话，按 Tab 可以填入示例');
      } else if (outcome === 'stopped') {
        ElMessage.success('已停止计算，配置的条件已保留');
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!busy.value) {
          say();
        }
        return;
      }
      // 空着时 Tab 填入占位的示例；有字时照常移动焦点
      if (event.key === 'Tab' && !event.shiftKey && !event.isComposing && text.value === '' && !busy.value) {
        event.preventDefault();
        if (props.conversation) {
          props.conversation.fillExample();
        } else {
          props.composer.fillExample();
        }
      }
    };

    const onInput = (event: Event) => {
      if (!(event.target instanceof HTMLTextAreaElement)) {
        return;
      }
      if (props.conversation) {
        props.conversation.setText(event.target.value);
      } else {
        props.composer.setText(event.target.value);
      }
    };

    return () => {
      const { conversation, composer } = props;
      const sending = busy.value;
      const reply = conversation?.reply.value ?? null;
      return (
        <footer class={styles.root} aria-label="AI 对话">
          <div class={styles.inner}>
            {conversation && (
              <div class={styles.suggestions} role="group" aria-label="快捷说法">
                {conversation.suggestions.value.map(words => (
                  <button key={words} type="button" class={styles.suggestion} onClick={() => say(words)}>
                    {words}
                  </button>
                ))}
              </div>
            )}
            <div class={styles.input}>
              <div class={styles.grow} data-value={text.value || example.value}>
                <textarea
                  class={styles.textarea}
                  rows={1}
                  value={text.value}
                  readonly={sending}
                  placeholder={example.value}
                  aria-label={conversation ? '对计算说的话' : '计算指令'}
                  onInput={onInput}
                  onKeydown={onKeydown}
                />
              </div>
              {!conversation && (
                <ElButton
                  class={styles.refresh}
                  link
                  icon={RefreshRight}
                  disabled={sending}
                  onClick={() => composer.refresh()}
                >
                  换一批
                </ElButton>
              )}
              <ElButton type="primary" icon={Promotion} loading={sending} onClick={() => say()}>
                {sending ? '配置中' : '发送'}
              </ElButton>
            </div>
            {reply && (
              <p class={styles.reply} role="status">
                <ChatAvatar speaker="assistant" size={20} />
                {reply}
              </p>
            )}
          </div>
        </footer>
      );
    };
  }
});
