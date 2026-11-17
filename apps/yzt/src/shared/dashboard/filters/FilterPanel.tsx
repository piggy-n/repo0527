import { defineComponent, type SlotsType, type VNode } from 'vue';
import fonts from '../shell/DashboardFonts.module.scss';
import styles from './filters.module.scss';

/** 左栏筛选面板的外壳；入场时整块从左侧进入（data-enter="left"），入场完成前不可操作 */
export const FilterPanel = defineComponent({
  name: 'DashboardFilterPanel',
  props: {
    active: { type: Boolean, default: true }
  },
  slots: Object as SlotsType<{ default?: () => VNode[] }>,
  setup(props, { slots }) {
    return () => (
      <aside class={[fonts.scope, styles.filters]} aria-label="大屏筛选条件" data-enter="left" inert={!props.active}>
        {slots.default?.()}
      </aside>
    );
  }
});
