import { defineComponent, type SlotsType, type VNode } from 'vue';
import styles from './MapCard.module.scss';

/**
 * 地图卡片入口：图标卡沿用 56 × 56；封面卡为 80 × 56，名称叠在缩略图右下角（ADR 0066）
 * pressed 表示它打开的面板正开着，由页面给出
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
          class={[styles.card, cover && styles.thumbnail, props.pressed && styles.pressed]}
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
