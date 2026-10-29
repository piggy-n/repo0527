import { Promotion, RefreshRight } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElMessage } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { PromptComposer, SendOutcome } from '../composables/usePromptComposer';
import styles from './AiPromptPanel.module.scss';

const WARNINGS: Readonly<Record<Exclude<SendOutcome, 'sent'>, string>> = {
  empty: '请输入推演指令',
  unrecognized: '没有识别出监测指标，可以点"刷新"换一条示例'
};

/** AI 推演指令：标题、对话输入框，框内底部是"刷新"和"发送"；回车发送（输入法选字时不算），Shift + 回车换行 */
export const AiPromptPanel = defineComponent({
  name: 'AiPromptPanel',
  props: {
    composer: { type: Object as PropType<PromptComposer>, required: true }
  },
  setup(props) {
    const send = () => {
      const outcome = props.composer.send();
      if (outcome !== 'sent') {
        ElMessage.warning(WARNINGS[outcome]);
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!props.composer.sending.value) {
          send();
        }
      }
    };

    return () => {
      const { composer } = props;
      const sending = composer.sending.value;
      return (
        <MxPanel class={styles.panel} title="AI 推演指令">
          {{
            default: () => (
              <div class={styles.input}>
                <textarea
                  class={styles.textarea}
                  rows={3}
                  value={composer.text.value}
                  readonly={sending}
                  placeholder="输入推演指令，例如：推演 2025 年南京市社区卫生服务设施步行15分钟覆盖率"
                  aria-label="推演指令"
                  onInput={event => {
                    if (event.target instanceof HTMLTextAreaElement) {
                      composer.setText(event.target.value);
                    }
                  }}
                  onKeydown={onKeydown}
                />
                <div class={styles.actions}>
                  <ElButton link icon={RefreshRight} disabled={sending} onClick={() => composer.refresh()}>
                    刷新
                  </ElButton>
                  <ElButton type="primary" size="small" icon={Promotion} loading={sending} onClick={send}>
                    {sending ? '编排中' : '发送'}
                  </ElButton>
                </div>
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
