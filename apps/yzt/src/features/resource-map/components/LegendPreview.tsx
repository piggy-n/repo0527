import { defineComponent, type PropType } from 'vue';
import { allClassesExcluded, type LegendEntry } from '../legend';
import { LegendSummaryIcon, LegendSwatchIcon } from './LegendSwatchIcon';

/**
 * 一个资源的符号摘要（ADR 0159）：统一样式是它的符号，按属性配色是代表取值按几何画的摘要（面拼色块、线是折线、点排成三角）。
 * 图例浮层的标题用 28 × 20；图层列表的行首、右侧图例的行用小号的 20 × 14（用户 2026-11-25），按小号的尺寸画，不整体缩放
 */
export const LegendPreview = defineComponent({
  name: 'LegendPreview',
  props: {
    entry: { type: Object as PropType<LegendEntry>, required: true },
    small: { type: Boolean, default: false }
  },
  setup(props) {
    return () => {
      const { entry } = props;
      const size = props.small ? 'small' : 'summary';
      // 按分类过滤到一类都不剩：地图上这个资源什么也不画，摘要也空着，不退回去画统一的符号（ADR 0175）
      if (allClassesExcluded(entry)) {
        return null;
      }
      if (entry.kind === 'symbol' || entry.mode === 'uniform' || entry.summary.length === 0) {
        return <LegendSwatchIcon swatch={entry.swatch} size={size} />;
      }
      return <LegendSummaryIcon swatches={entry.summary} size={size} />;
    };
  }
});
