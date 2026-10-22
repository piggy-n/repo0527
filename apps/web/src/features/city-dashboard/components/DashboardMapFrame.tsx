import { computed, defineComponent, ref, shallowRef } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import styles from './DashboardMap.module.scss';

/** 按容器宽高绘制两条对称路径，保持旧版描边动画和圆角 */
export const DashboardMapFrame = defineComponent({
  name: 'DashboardMapFrame',
  setup() {
    const frame = ref<SVGSVGElement>();
    const size = shallowRef({ width: 1, height: 1 });
    useResizeObserver(frame, entries => {
      const rectangle = entries[0]?.contentRect;
      if (rectangle && rectangle.width > 2 && rectangle.height > 2) {
        size.value = { width: rectangle.width, height: rectangle.height };
      }
    });
    // 从上边中点出发，分别沿左半边、右半边画到下边中点；四角是圆角，线描在 1 像素内侧
    const paths = computed(() => {
      const { width, height } = size.value;
      const radius = Math.min(10, width / 4, height / 4);
      const center = width / 2;
      const right = width - 1;
      const bottom = height - 1;
      const left = [
        `M ${center} 1 H ${radius} Q 1 1 1 ${radius}`,
        `V ${height - radius} Q 1 ${bottom} ${radius} ${bottom} H ${center}`
      ];
      const rightSide = [
        `M ${center} 1 H ${width - radius} Q ${right} 1 ${right} ${radius}`,
        `V ${height - radius} Q ${right} ${bottom} ${width - radius} ${bottom} H ${center}`
      ];
      return [left.join(' '), rightSide.join(' ')];
    });
    return () => (
      <svg
        ref={frame}
        class={styles.frame}
        viewBox={`0 0 ${size.value.width} ${size.value.height}`}
        data-scene="frame"
        aria-hidden="true"
      >
        <g class={styles.frameSoft}>{paths.value.map(path => <path key={path} d={path} pathLength={1} />)}</g>
        <g class={styles.frameLine}>{paths.value.map(path => <path key={path} d={path} pathLength={1} />)}</g>
      </svg>
    );
  }
});
