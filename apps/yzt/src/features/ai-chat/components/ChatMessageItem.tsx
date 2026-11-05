import { DataAnalysis, MapLocation } from '@element-plus/icons-vue';
import { ElIcon } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { ChatAvatar } from '@/shared/chat-avatar/ChatAvatar';
import { statsText } from '../chat-result';
import type { ChatMessage } from '../composables/useAiChat';
import { renderMarkdown } from '../markdown';
import { stepsRunning } from '../tool-steps';
import styles from './ChatMessageItem.module.scss';
import { ToolSteps } from './ToolSteps';

const clock = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/** 一条消息：提问是主色气泡；回答依次是查询步骤、Markdown 正文或"正在思考"，下方是时间与用量 */
export const ChatMessageItem = defineComponent({
  name: 'ChatMessageItem',
  props: {
    message: { type: Object as PropType<ChatMessage>, required: true }
  },
  setup(props) {
    const stepsExpanded = ref(props.message.live);
    const html = computed(() => renderMarkdown(props.message.content));

    const renderAnswer = () => {
      const { content, pending, steps, error } = props.message;
      // 步骤还在进行时由步骤显示进度，不再显示"正在思考"
      const thinking = pending && content === '' && !stepsRunning(steps);
      return (
        <div class={[styles.bubble, styles.answer]}>
          {steps.length > 0 && (
            <ToolSteps
              steps={steps}
              expanded={stepsExpanded.value}
              onUpdate:expanded={value => (stepsExpanded.value = value)}
            />
          )}
          {thinking && (
            <div class={styles.thinking} role="status">
              <span class={styles.dot} />
              <span class={styles.dot} />
              <span class={styles.dot} />
              <span>AI 正在思考</span>
            </div>
          )}
          {content !== '' && (
            <div class={[styles.markdown, pending && styles.streaming]} innerHTML={html.value} />
          )}
          {!pending && content === '' && error === null && <p class={styles.empty}>（无回复）</p>}
          {error !== null && <p class={styles.error}>请求失败：{error}</p>}
        </div>
      );
    };

    const renderMeta = () => {
      const { role, pending, stats, hasMap, hasChart, timestamp } = props.message;
      const usage = role === 'assistant' && !pending ? statsText(stats) : '';
      return (
        <div class={styles.meta}>
          <span>{clock(timestamp)}</span>
          {pending && stats.tokenCount > 0 && <span class={styles.badge}>{stats.tokenCount} tokens</span>}
          {usage !== '' && <span class={styles.badge}>{usage}</span>}
          {hasMap && (
            <span class={styles.badge}>
              <ElIcon>
                <MapLocation />
              </ElIcon>
              地图数据
            </span>
          )}
          {hasChart && (
            <span class={styles.badge}>
              <ElIcon>
                <DataAnalysis />
              </ElIcon>
              图表
            </span>
          )}
        </div>
      );
    };

    return () => {
      const user = props.message.role === 'user';
      return (
        <article class={[styles.root, user && styles.user]} data-role={props.message.role}>
          <ChatAvatar speaker={props.message.role} />
          <div class={styles.body}>
            {user ? <div class={[styles.bubble, styles.question]}>{props.message.content}</div> : renderAnswer()}
            {renderMeta()}
          </div>
        </article>
      );
    };
  }
});
