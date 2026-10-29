import { Promotion, RefreshRight } from '@element-plus/icons-vue';
import { useTextareaAutosize } from '@vueuse/core';
import { ElButton, ElMessage } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import type { PromptComposer, SendOutcome } from '../composables/usePromptComposer';
import type { RunConversation } from '../composables/useRunConversation';
import styles from './AiDock.module.scss';

const WARNINGS: Readonly<Record<Exclude<SendOutcome, 'sent'>, string>> = {
  empty: '请输入推演指令',
  unrecognized: '没有识别出监测指标，可以点"刷新"换一条示例'
};

const RUN_HINTS: Readonly<Record<RunConversation['phase']['value'], string>> = {
  running: '推演中 · 随时可以打断：暂停、改参数、调整范围或指标',
  paused: '已暂停 · 说"继续"接着推演，也可以先改参数或范围',
  done: '推演完成 · 继续对话会在这一版的基础上重新推演'
};

/**
 * 页面底部的 AI 对话栏：条件编排时写推演指令（刷新换示例、发送后 AI 逐个节点编排）；推演和结果阶段对推演说话，
 * 上方是按当前条件给的快捷说法。回车发送（输入法选字时不算），Shift + 回车换行，输入框随内容长到三行
 */
export const AiDock = defineComponent({
  name: 'AiDock',
  props: {
    composer: { type: Object as PropType<PromptComposer>, required: true },
    /** 推演和结果阶段的对话；条件编排时为 null */
    conversation: { type: Object as PropType<RunConversation | null>, default: null }
  },
  setup(props) {
    const textarea = ref<HTMLTextAreaElement>();
    const text = computed(() => (props.conversation ? props.conversation.text.value : props.composer.text.value));
    useTextareaAutosize({ element: textarea, input: text, styleProp: 'minHeight' });
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
        ElMessage.warning('先输入要对推演说的话');
      } else if (outcome === 'stopped') {
        ElMessage.success('已停止推演，编排的条件已保留');
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!busy.value) {
          say();
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
      const phase = conversation?.phase.value;
      let hint: string;
      if (phase) {
        hint = RUN_HINTS[phase];
      } else {
        hint = sending ? 'AI 正在按指令编排条件，完成后自动开始推演' : '回车发送，Shift + 回车换行；也可以在上方手动编排后点"开始推演"';
      }
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
              <span class={styles.orb} aria-hidden="true" />
              <textarea
                ref={textarea}
                class={styles.textarea}
                rows={1}
                value={text.value}
                readonly={sending}
                placeholder={
                  conversation
                    ? phase === 'done'
                      ? '还想看什么？例如：改成旧规程、加上苏州市'
                      : '对推演说话：暂停、改成相交即算、加上苏州市…'
                    : '输入推演指令，例如：推演 2025 年南京市社区卫生服务设施步行15分钟覆盖率'
                }
                aria-label={conversation ? '对推演说的话' : '推演指令'}
                onInput={onInput}
                onKeydown={onKeydown}
              />
              {!conversation && (
                <ElButton class={styles.refresh} link icon={RefreshRight} disabled={sending} onClick={() => composer.refresh()}>
                  刷新
                </ElButton>
              )}
              <ElButton type="primary" icon={Promotion} loading={sending} onClick={() => say()}>
                {sending ? '编排中' : '发送'}
              </ElButton>
            </div>
            <p class={styles.hint}>{hint}</p>
          </div>
        </footer>
      );
    };
  }
});
