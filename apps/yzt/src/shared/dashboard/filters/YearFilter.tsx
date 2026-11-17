import { defineComponent, type PropType } from 'vue';
import { ElOption, ElSelect } from 'element-plus';
import { FilterSection } from './FilterSection';
import styles from './filters.module.scss';

/** 比较年份的多选；下拉传送到 body，用驾驶舱专属的 popper 类隔离外观 */
export const YearFilter = defineComponent({
  name: 'DashboardYearFilter',
  props: {
    title: { type: String, default: '年份选择' },
    options: { type: Array as PropType<readonly number[]>, required: true },
    selected: { type: Array as PropType<readonly number[]>, required: true },
    clearable: { type: Boolean, default: true }
  },
  emits: {
    change: (_years: number[]) => true
  },
  setup(props, { emit }) {
    return () => (
      <FilterSection title={props.title}>
        <ElSelect
          class={styles.years}
          popperClass={styles.yearPopper}
          modelValue={[...props.selected]}
          multiple
          clearable={props.clearable}
          placeholder="请选择比较年份"
          aria-label="选择比较年份"
          onUpdate:modelValue={(value: number[]) => emit('change', value)}
        >
          {props.options.map(year => <ElOption key={year} value={year} label={String(year)} />)}
        </ElSelect>
      </FilterSection>
    );
  }
});
