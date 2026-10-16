import { defineComponent, type SlotsType, type VNode } from 'vue';
import styles from './MapCard.module.scss';

/**
 * 卡片行的入口（ADR 0053 第 1 节、ADR 0057）：56 × 56 的白底卡片，上面是图（图标，或铺满的缩略图），下面一行字；
 * 两张卡片结构相同，文字在同一条线上。pressed 表示它打开的面板正开着，由页面给出
 */
export const MapCard = defineComponent({
  name: 'MapCard',
  props: {
    label: { type: String, required: true },
    /** 无障碍名称，要包含 label；文字只写简称（如底图卡的"矢量"）时给出全称，不写时就是 label */
    name: { type: String, default: undefined },
    pressed: { type: Boolean, default: false }
  },
  emits: {
    click: () => true
  },
  slots: Object as SlotsType<{
    /** 放在浅灰底上居中的图标 */
    icon?: () => VNode[];
    /** 铺满图片位置的图，如底图的缩略图 */
    cover?: () => VNode[];
  }>,
  setup(props, { emit, slots }) {
    return () => {
      const cover = slots.cover?.();
      return (
        <button
          type="button"
          class={[styles.card, props.pressed && styles.pressed]}
          aria-label={props.name}
          aria-pressed={props.pressed}
          onClick={() => emit('click')}>
          <span class={[styles.media, cover && styles.covered]}>{cover ?? slots.icon?.()}</span>
          <span class={styles.label}>{props.label}</span>
        </button>
      );
    };
  }
});
