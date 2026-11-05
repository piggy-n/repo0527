import { RefreshRight } from '@element-plus/icons-vue';
import { ElButton, ElTooltip } from 'element-plus';
import { defineComponent, onMounted, type PropType, ref, shallowRef, watch } from 'vue';
import { ChatAvatar } from '@/shared/chat-avatar/ChatAvatar';
import type { AiChat, ChatMessage } from '../composables/useAiChat';
import { INITIAL_EXAMPLE_COUNT, nextExampleCount, pickExamples } from '../examples';
import styles from './ChatConversation.module.scss';
import { ChatMessageItem } from './ChatMessageItem';

// 离底部不超过这个距离时，流式输出继续跟随到底部；往上翻看时不拉回来（沿用旧项目）
const FOLLOW_THRESHOLD = 48;

// 追加了新消息，或换成了另一组消息（打开历史、新对话）
function replacedOrAppended(next: readonly ChatMessage[], previous: readonly ChatMessage[]): boolean {
  return next.length !== previous.length || next[0]?.id !== previous[0]?.id;
}

function renderWelcome() {
  return (
    <div class={styles.welcome}>
      <ChatAvatar class={styles.robot} speaker="assistant" size={56} />
      <h3 class={styles.greeting}>您好，我是空间查询助手</h3>
      <p class={styles.intro}>支持自然资源空间数据、图层、统计、分析等多维度查询与知识问答</p>
    </div>
  );
}

/** 对话区：欢迎语、快捷提问和消息列表；提问和打开历史后滚到底部，回答过程中按用户的位置决定是否跟随 */
export const ChatConversation = defineComponent({
  name: 'ChatConversation',
  props: {
    chat: { type: Object as PropType<AiChat>, required: true }
  },
  setup(props) {
    const scroller = ref<HTMLElement>();
    const examples = shallowRef(pickExamples(INITIAL_EXAMPLE_COUNT));
    let follow = true;

    const scrollToBottom = () => {
      if (scroller.value) {
        scroller.value.scrollTop = scroller.value.scrollHeight;
      }
      follow = true;
    };

    const onScroll = () => {
      const element = scroller.value;
      if (element) {
        follow = element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD;
      }
    };

    // 从历史回到对话时重新挂载，回到底部
    onMounted(scrollToBottom);
    watch(
      () => props.chat.messages.value,
      (next, previous) => {
        if (follow || replacedOrAppended(next, previous)) {
          scrollToBottom();
        }
      },
      { flush: 'post' }
    );

    const refreshExamples = () => {
      examples.value = pickExamples(nextExampleCount());
    };

    const renderExamples = () => (
      <section class={styles.examples} aria-label="快捷提问">
        <div class={styles.examplesHeader}>
          <span class={styles.examplesTitle}>快捷提问</span>
          <span class={styles.examplesCount}>{examples.value.length} 个建议</span>
          <ElTooltip content="换一批" placement="top">
            <ElButton class={styles.refresh} link icon={RefreshRight} aria-label="换一批" onClick={refreshExamples} />
          </ElTooltip>
        </div>
        <div class={styles.chips}>
          {examples.value.map(example => (
            <button key={example} type="button" class={styles.chip} onClick={() => void props.chat.send(example)}>
              {example}
            </button>
          ))}
        </div>
      </section>
    );

    return () => {
      const messages = props.chat.messages.value;
      return (
        <div ref={scroller} class={styles.root} onScroll={onScroll}>
          {messages.length === 0 && renderWelcome()}
          {!props.chat.sending.value && renderExamples()}
          {messages.map(message => (
            <ChatMessageItem key={message.id} message={message} />
          ))}
        </div>
      );
    };
  }
});
