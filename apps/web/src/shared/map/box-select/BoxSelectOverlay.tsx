import type { ScreenBox } from '@yzt/map-core';
import { defineComponent, type PropType, type Ref, ref } from 'vue';
import { useShownElementSize } from '../../composables/useShownElementSize';
import type { PointerHintContent } from '../pointer-hint/pointer-hint';
import { PointerHint } from '../pointer-hint/PointerHint';
import styles from './BoxSelectOverlay.module.scss';

/** 浮层所需的只读状态，由业务拥有者提供，公共组件不依赖业务类型 */
export interface BoxSelectOverlayState {
  readonly boxDraft: Readonly<Ref<ScreenBox | null>>;
  readonly hint: Readonly<Ref<PointerHintContent | null>>;
}

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
    /** 在浮层里读取高频状态，页面只传稳定的拥有者 */
    pick: { type: Object as PropType<BoxSelectOverlayState>, required: true }
  },
  setup(props) {
    const root = ref<HTMLElement>();
    const canvas = useShownElementSize(root);

    return () => {
      const box = props.pick.boxDraft.value;
      const hint = props.pick.hint.value;
      return (
        <div ref={root} class={styles.overlay} data-box-select-overlay>
          {box && <div class={styles.box} style={boxStyle(box)} data-box />}
          {hint && (
            <PointerHint
              point={hint.point}
              canvas={{ width: canvas.width.value, height: canvas.height.value }}
              lines={hint.lines}
            />
          )}
        </div>
      );
    };
  }
});
