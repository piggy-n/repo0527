import { defineComponent, type SlotsType, type VNode } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import styles from './filters.module.scss';

/** 筛选区块：驾驶舱彩色标记的标题，入场时逐块错开（data-filter-group） */
export const FilterSection = defineComponent({
  name: 'DashboardFilterSection',
  props: {
    title: { type: String, required: true },
    /** 占满面板剩余的高度，内容在区块里滚动 */
    fill: { type: Boolean, default: false }
  },
  slots: Object as SlotsType<{
    /** 标题右侧的按钮 */
    extra?: () => VNode[];
    default?: () => VNode[];
  }>,
  setup(props, { slots }) {
    function renderHeading() {
      return (
        <h2 class={styles.heading}>
          <SvgIcon name="dashboard-section-color" size={16} />
          <span>{props.title}</span>
        </h2>
      );
    }

    return () => (
      <section class={[styles.group, props.fill && styles.fill]} data-filter-group>
        {slots.extra ? (
          <div class={styles.headingRow}>
            {renderHeading()}
            {slots.extra()}
          </div>
        ) : renderHeading()}
        {slots.default?.()}
      </section>
    );
  }
});
