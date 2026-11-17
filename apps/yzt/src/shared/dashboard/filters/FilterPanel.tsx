import { defineComponent, type SlotsType, type VNode } from 'vue';
import fonts from '../shell/DashboardFonts.module.scss';
import styles from './filters.module.scss';

/** 左栏筛选面板的外壳；入场时整块从左侧进入（data-enter="left"），入场完成前不可操作 */
export const FilterPanel = defineComponent({
  name: 'DashboardFilterPanel',
  props: {
    active: { type: Boolean, default: true },
    /** 矮屏（宽于 1180px、高不超过 900px）时收紧行高和间距，选项多的页面用 */
    compact: { type: Boolean, default: false }
  },
  slots: Object as SlotsType<{ default?: () => VNode[] }>,
  setup(props, { slots }) {
    return () => (
      <aside
        class={[fonts.scope, styles.filters, props.compact && styles.compact]}
        aria-label="大屏筛选条件"
        data-enter="left"
        inert={!props.active}
      >
        {slots.default?.()}
      </aside>
    );
  }
});
