import { useElementSize } from '@vueuse/core';
import type { ScreenBox } from '@yzt/map-core';
import { defineComponent, type PropType, ref } from 'vue';
import type { PointerHintContent } from '../pointer-hint/pointer-hint';
import { PointerHint } from '../pointer-hint/PointerHint';
import styles from './BoxSelectOverlay.module.scss';

/** 框的屏幕位置：起点和当前点可以在任意方向 */
export function boxStyle({ from, to }: ScreenBox) {
  return {
    left: `${Math.min(from.x, to.x)}px`,
    top: `${Math.min(from.y, to.y)}px`,
    width: `${Math.abs(to.x - from.x)}px`,
    height: `${Math.abs(to.y - from.y)}px`
  };
}

/**
 * 点/框选的浮层：拖动框选时的矩形（ADR 0049 第 1 节，设计稿 5D.7 保留原来的外观）和鼠标旁的提示（ADR 0056）。
 * 和画布放在同一个定位参照里盖在上面，不拦截地图的鼠标操作；框和提示由点选的拥有者给出，这里只显示
 */
export const BoxSelectOverlay = defineComponent({
  name: 'BoxSelectOverlay',
  props: {
    /** 正在画的框；没有在框选时为 null */
    box: { type: Object as PropType<ScreenBox | null>, default: null },
    /** 鼠标旁的提示；不显示时为 null */
    hint: { type: Object as PropType<PointerHintContent | null>, default: null }
  },
  setup(props) {
    const root = ref<HTMLElement>();
    const canvas = useElementSize(root);

    return () => (
      <div ref={root} class={styles.overlay} data-box-select-overlay>
        {props.box && <div class={styles.box} style={boxStyle(props.box)} data-box />}
        {props.hint && (
          <PointerHint
            point={props.hint.point}
            canvas={{ width: canvas.width.value, height: canvas.height.value }}
            lines={props.hint.lines}
          />
        )}
      </div>
    );
  }
});
