import { defineComponent, type PropType } from 'vue';
import assistantImage from './assistant.webp';
import styles from './ChatAvatar.module.scss';

/** 对话里说话的一方：AI 助手或用户 */
export type ChatSpeaker = 'assistant' | 'user';

// 机器人约占圆底宽度的 72%，取双数：56 → 40、32 → 24（ADR 0102 第 7 节）
const imageWidth = (size: number) => Math.round(size * 0.36) * 2;

/** 对话的圆形头像：AI 助手是主色圆底上的机器人，用户是浅主色圆底上的"我"；只是装饰，读屏跳过 */
export const ChatAvatar = defineComponent({
  name: 'ChatAvatar',
  props: {
    speaker: { type: String as PropType<ChatSpeaker>, required: true },
    /** 圆底的直径（像素） */
    size: { type: Number, default: 32 }
  },
  setup(props) {
    return () => {
      const { speaker, size } = props;
      return (
        <span
          class={[styles.root, speaker === 'user' && styles.user]}
          style={{ width: `${size}px`, height: `${size}px` }}
          aria-hidden="true"
        >
          {speaker === 'user' ? (
            '我'
          ) : (
            <img class={styles.image} src={assistantImage} alt="" style={{ width: `${imageWidth(size)}px` }} />
          )}
        </span>
      );
    };
  }
});
