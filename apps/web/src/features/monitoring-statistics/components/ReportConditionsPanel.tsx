import { MxPanel } from '@yzt/ui';
import { ElDatePicker, ElRadioButton, ElRadioGroup, ElSkeleton } from 'element-plus';
import { defineComponent, type PropType, type VNode } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { StatisticsReport } from '../composables/useStatisticsReport';
import type { ReportOption } from '../report';
import styles from './ReportConditionsPanel.module.scss';

/** 选择查看报表：年份、行政区划等级、报表类型；后两项的选项来自后端，这一年还没有报表时说明 */
export const ReportConditionsPanel = defineComponent({
  name: 'ReportConditionsPanel',
  props: {
    report: { type: Object as PropType<StatisticsReport>, required: true }
  },
  setup(props) {
    // 选项随第一次查询返回，很快返回时不闪骨架
    const showSkeleton = useDelayedFlag(
      () => props.report.loading.value && props.report.tableOptions.value.length === 0
    );

    const renderOptions = <T extends string>(
      options: readonly ReportOption<T>[],
      value: T,
      label: string,
      change: (value: T) => void
    ): VNode | null => {
      if (props.report.tableOptions.value.length === 0) {
        if (props.report.loading.value) {
          return showSkeleton.value ? <ElSkeleton class={styles.skeleton} rows={0} animated /> : null;
        }
        return <span class={styles.empty}>该年度暂无已生成的报表</span>;
      }
      return (
        <ElRadioGroup
          size="small"
          aria-label={label}
          modelValue={value}
          onUpdate:modelValue={next => {
            const option = options.find(item => item.value === next);
            if (option) {
              change(option.value);
            }
          }}
        >
          {options.map(option => (
            <ElRadioButton key={option.value} value={option.value}>
              {option.label}
            </ElRadioButton>
          ))}
        </ElRadioGroup>
      );
    };

    return () => {
      const { report } = props;
      const { year, table, level } = report.criteria.value;
      return (
        <MxPanel title="选择查看报表">
          <div class={styles.rows}>
            <div class={styles.row}>
              <span class={styles.label}>监测年份</span>
              <ElDatePicker
                class={styles.year}
                type="year"
                modelValue={year}
                valueFormat="YYYY"
                format="YYYY年"
                clearable={false}
                onUpdate:modelValue={(value: string) => report.setYear(value)}
              />
            </div>
            <div class={styles.row}>
              <span class={styles.label}>行政区划</span>
              {renderOptions(report.levelOptions.value, level, '行政区划', report.setLevel)}
            </div>
            <div class={styles.row}>
              <span class={styles.label}>报表类型</span>
              {renderOptions(report.tableOptions.value, table, '报表类型', report.setTable)}
            </div>
          </div>
        </MxPanel>
      );
    };
  }
});
