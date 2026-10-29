import { defineComponent, type PropType } from 'vue';
import type { Rich } from '../run/narrative';
import styles from './RichText.module.scss';

/** 带强调的文字；limit 是打字效果已经打出的字数，强调的部分按原样计数 */
export const RichText = defineComponent({
  name: 'RichText',
  props: {
    text: { type: Array as PropType<Rich>, required: true },
    limit: { type: Number, default: Number.POSITIVE_INFINITY }
  },
  setup(props) {
    return () => {
      let left = props.limit;
      return props.text.map((part, index) => {
        const content = typeof part === 'string' ? part : part.em;
        const shown = content.slice(0, Math.max(0, left));
        left -= content.length;
        if (shown === '') {
          return null;
        }
        return typeof part === 'string' ? (
          shown
        ) : (
          <em key={index} class={styles.em}>
            {shown}
          </em>
        );
      });
    };
  }
});
