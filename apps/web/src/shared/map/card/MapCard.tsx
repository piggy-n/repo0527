import { defineComponent, type SlotsType, type VNode } from 'vue';
import styles from './MapCard.module.scss';

/**
 * 卡片行的入口（ADR 0053 第 1 节，设计稿 5D.4）：56 × 56，图标加文字，或者铺满一张图、文字在底部。
 * pressed 表示它打开的面板正开着（和工具栏的"面板打开"一样），由页面给出
 */
export const MapCard = defineComponent({
  name: 'MapCard',
  props: {
    label: { type: String, required: true },
    pressed: { type: Boolean, default: false }
  },
  emits: {
    click: () => true
  },
  slots: Object as SlotsType<{
    /** 文字上面的图标 */
    icon?: () => VNode[];
    /** 铺满卡片的图，文字压在底部 */
    cover?: () => VNode[];
  }>,
  setup(props, { emit, slots }) {
    return () => {
      const cover = slots.cover?.();
      return (
        <button
          type="button"
          class={[styles.card, cover ? styles.covered : styles.iconic, props.pressed && styles.pressed]}
          aria-pressed={props.pressed}
          onClick={() => emit('click')}>
          {cover ? <span class={styles.cover}>{cover}</span> : slots.icon?.()}
          <span class={styles.label}>{props.label}</span>
        </button>
      );
    };
  }
});
