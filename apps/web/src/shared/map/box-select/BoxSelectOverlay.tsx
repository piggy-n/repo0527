import type { ScreenBox } from '@yzt/map-core';
import { defineComponent, type PropType } from 'vue';
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
 * 拖动框选时的矩形（联调用的界面，5D 再设计；ADR 0049 第 1 节）。和画布放在同一个定位参照里盖在上面，
 * 不拦截地图的鼠标操作；框由点选的拥有者给出，这里只显示
 */
export const BoxSelectOverlay = defineComponent({
  name: 'BoxSelectOverlay',
  props: {
    /** 正在画的框；没有在框选时为 null */
    box: { type: Object as PropType<ScreenBox | null>, default: null }
  },
  setup(props) {
    return () => (
      <div class={styles.overlay} data-box-select-overlay>
        {props.box && <div class={styles.box} style={boxStyle(props.box)} />}
      </div>
    );
  }
});
