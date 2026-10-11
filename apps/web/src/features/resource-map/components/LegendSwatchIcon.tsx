import { defineComponent, type PropType } from 'vue';
import type { LegendSwatch } from '../legend';
import styles from './LegendSwatchIcon.module.scss';

/** 图例里的符号预览：面是填充加描边，线是一段线，点是带描边的圆点；颜色是地图样式的数据，用内联样式 */
export const LegendSwatchIcon = defineComponent({
  name: 'LegendSwatchIcon',
  props: {
    swatch: { type: Object as PropType<LegendSwatch>, required: true }
  },
  setup(props) {
    return () => {
      const { swatch } = props;
      if (swatch.geometry === 'fill') {
        return (
          <span
            class={[styles.swatch, styles.fill]}
            style={{ backgroundColor: swatch.fill, borderColor: swatch.outline }}
            aria-hidden="true"
          />
        );
      }
      if (swatch.geometry === 'line') {
        return (
          <span class={[styles.swatch, styles.line]} style={{ borderTopColor: swatch.color }} aria-hidden="true" />
        );
      }
      return (
        <span
          class={[styles.swatch, styles.circle]}
          style={{ backgroundColor: swatch.fill, borderColor: swatch.stroke }}
          aria-hidden="true"
        />
      );
    };
  }
});
