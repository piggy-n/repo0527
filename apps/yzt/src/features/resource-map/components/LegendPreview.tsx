import { defineComponent, type PropType } from 'vue';
import type { LegendEntry } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './LegendPreview.module.scss';

/**
 * 一个资源的符号摘要（设计稿 5D.5）：统一符号是它的预览，按属性配色是前三个取值的颜色并排，都是 28 × 20；
 * 当前图层的行首、图例浮层的标题用，同右侧图例收起时的摘要
 */
export const LegendPreview = defineComponent({
  name: 'LegendPreview',
  props: {
    entry: { type: Object as PropType<LegendEntry>, required: true }
  },
  setup(props) {
    return () => {
      const { entry } = props;
      if (entry.kind === 'symbol' || entry.mode === 'uniform') {
        return <LegendSwatchIcon swatch={entry.swatch} />;
      }
      return (
        <span class={styles.colors} aria-hidden="true" data-colors>
          {entry.colors.map(color => (
            <i style={{ backgroundColor: color }} />
          ))}
        </span>
      );
    };
  }
});
