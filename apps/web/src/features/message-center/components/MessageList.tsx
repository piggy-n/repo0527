import { ElButton, ElEmpty, ElSkeleton } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { SvgIcon, type IconName } from '@/shared/icons/SvgIcon';
import type { Message } from '../api';
import { categoryLabels, messageTone } from '../presentation';
import styles from './message-center.module.scss';

const statusIcons: Record<ReturnType<typeof messageTone>, IconName> = {
  warning: 'warning',
  success: 'check',
  danger: 'status-error',
  info: 'info'
};

/** 紧凑消息列表：整行查看正文，业务处理放在详情中 */
export const MessageList = defineComponent({
  name: 'MessageList',
  props: {
    messages: { type: Array as PropType<Message[]>, required: true },
    loading: Boolean,
    failed: Boolean,
    empty: Boolean
  },
  emits: {
    select: (_id: string) => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const skeleton = useDelayedFlag(() => props.loading);
    return () => {
      if (props.loading) {
        return (
          <div class={styles.state} aria-busy="true">
            {skeleton.value && <ElSkeleton rows={7} animated />}
          </div>
        );
      }
      if (props.failed) {
        return (
          <div class={styles.state} role="alert">
            <p>消息加载失败</p>
            <p class={styles.hint}>请稍后重试</p>
            <ElButton onClick={() => emit('retry')}>重新加载</ElButton>
          </div>
        );
      }
      if (!props.messages.length) {
        return <ElEmpty description={props.empty ? '暂无消息' : '暂无符合条件的消息'} imageSize={64} />;
      }
      return (
        <div class={styles.list}>
          {props.messages.map(message => {
            const tone = messageTone(message);
            return (
              <button
                type="button"
                key={message.msgId}
                class={[styles.message, !message.isRead && styles.unread]}
                aria-label={`${message.title}，${message.isRead ? '已读' : '未读'}，${message.createTime}`}
                onClick={() => emit('select', message.msgId)}
              >
                <span class={[styles.messageIcon, styles[tone]]}>
                  <SvgIcon name={statusIcons[tone]} />
                </span>
                <span class={styles.messageContent}>
                  <span class={styles.messageHeading}>
                    <strong>{message.title}</strong>
                    {!message.isRead && <span class={styles.dot} aria-hidden="true" />}
                  </span>
                  <span class={styles.summary}>{message.content}</span>
                  <span class={styles.meta}>
                    <span>{categoryLabels[message.category]}</span>
                    <time>{message.createTime}</time>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      );
    };
  }
});
