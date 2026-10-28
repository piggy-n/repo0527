import { RefreshRight, User } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElIcon } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import assistantImage from './assistant.png';
import { examples, type PreviewMessage } from './preview-data';
import styles from './preview.module.scss';

/** 沿用旧版欢迎卡、快捷提问和左右消息布局 */
export const ChatMessages = defineComponent({
  name: 'DevAiChatMessages',
  props: {
    messages: { type: Array as PropType<PreviewMessage[]>, required: true },
    pending: Boolean,
    failed: Boolean
  },
  emits: {
    send: (_text: string) => true,
    retry: () => true
  },
  setup(props, { emit }) {
    // 换一组只轮换本地建议，不请求 AI 服务
    const exampleGroup = ref(0);
    const suggestions = computed(() => examples.slice(exampleGroup.value * 4, exampleGroup.value * 4 + 4));

    return () => (
      <div class={styles.messages}>
        {!props.messages.length && (
          <section class={styles.welcome}>
            <img src={assistantImage} alt="空间查询助手" />
            <h3>您好，我是空间查询助手</h3>
            <p>支持自然资源空间数据、图层、统计、分析等多维度查询与知识问答</p>
          </section>
        )}
        {!props.pending && (
          <section class={styles.suggestions}>
            <div class={styles.sectionHeader}>
              <MxTitle level="section" description="4 个建议">快捷提问</MxTitle>
              <span title="换一组">
                <ElButton
                  size="small"
                  icon={RefreshRight}
                  aria-label="换一组快捷提问"
                  onClick={() => (exampleGroup.value = (exampleGroup.value + 1) % 2)}
                />
              </span>
            </div>
            <div class={styles.chips}>
              {suggestions.value.map(text => (
                <button type="button" key={text} onClick={() => emit('send', text)}>{text}</button>
              ))}
            </div>
          </section>
        )}
        {props.messages.map((message, index) => (
          <article class={[styles.message, message.role === 'user' && styles.user]} key={index}>
            <span class={styles.avatar}>
              {message.role === 'user' ? (
                <ElIcon aria-label="我"><User /></ElIcon>
              ) : (
                <img src={assistantImage} alt="空间查询助手" />
              )}
            </span>
            <div class={styles.messageBody}>
              {message.role === 'assistant' && message.text && (
                <details class={styles.steps}>
                  <summary>查询过程 · 演示步骤</summary>
                  <ol>
                    <li>识别查询范围：江苏省</li>
                    <li>汇总各市耕地面积</li>
                    <li>生成地图、表格与图表</li>
                  </ol>
                </details>
              )}
              <p>
                {message.text || (props.pending && index === props.messages.length - 1 ? '正在查询…' : '本次回答未完成')}
              </p>
            </div>
          </article>
        ))}
        {props.failed && (
          <div class={styles.failure} role="alert">
            连接中断，请稍后重新发送。
            <ElButton link type="primary" onClick={() => emit('retry')}>
              重试
            </ElButton>
          </div>
        )}
      </div>
    );
  }
});
