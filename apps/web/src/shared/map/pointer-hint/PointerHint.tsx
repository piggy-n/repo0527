import { useElementSize } from '@vueuse/core';
import type { ScreenPoint } from '@yzt/map-core';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { pointerHintSides, type Size } from './pointer-hint';
import styles from './PointerHint.module.scss';

/**
 * 鼠标旁的提示（设计稿 5D.7）：测量、拾取共用。放在盖着画布的浮层里，位置是鼠标在画布上的坐标；
 * 第一行可以是加粗的数值，下面是操作说明。默认在鼠标右下方，靠近画布右边、下边时翻到另一侧
 */
export const PointerHint = defineComponent({
  name: 'PointerHint',
  props: {
    point: { type: Object as PropType<ScreenPoint>, required: true },
    /** 所在浮层（和画布一样大）的尺寸，判断是否放得下 */
    canvas: { type: Object as PropType<Size>, required: true },
    /** 加粗的第一行，如正在画的长度；没有时为 null */
    value: { type: String as PropType<string | null>, default: null },
    lines: { type: Array as PropType<readonly string[]>, required: true }
  },
  setup(props) {
    const element = ref<HTMLElement>();
    const { width, height } = useElementSize(element, undefined, { box: 'border-box' });
    const sides = computed(() =>
      pointerHintSides(props.point, { width: width.value, height: height.value }, props.canvas)
    );

    return () => (
      <div
        ref={element}
        class={[styles.hint, styles[sides.value.x], styles[sides.value.y]]}
        style={{ left: `${props.point.x}px`, top: `${props.point.y}px` }}
        data-pointer-hint={`${sides.value.x} ${sides.value.y}`}>
        {props.value && <strong class={styles.value}>{props.value}</strong>}
        {/* 有数值时说明都是次要的；没有时第一行是主要的操作 */}
        {props.lines.map((line, index) => (
          <span key={line} class={props.value || index > 0 ? styles.note : undefined}>
            {line}
          </span>
        ))}
      </div>
    );
  }
});
