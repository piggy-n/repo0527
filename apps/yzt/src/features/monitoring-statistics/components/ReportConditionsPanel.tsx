import { MxPanel } from '@yzt/ui';
import { ElDatePicker, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSkeleton } from 'element-plus';
import { defineComponent, type PropType, type VNode } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { StatisticsReport } from '../composables/useStatisticsReport';
import { isBaseYearValid } from '../statistics';
import styles from './ReportConditionsPanel.module.scss';

/**
 * 选择查看报表：监测年份、报表类型、本底年份（只有变化类报表有）、行政区划。报表类型和等级的选项来自后端，
 * 六种报表名称较长，用下拉选择；这一年还没有报表时说明
 */
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

    // 还没有选项时：加载中是骨架，这一年没有报表时说明
    const renderPending = (): VNode | null => {
      if (props.report.loading.value) {
        return showSkeleton.value ? <ElSkeleton class={styles.skeleton} rows={0} animated /> : null;
      }
      return <span class={styles.empty}>该年度暂无已生成的报表</span>;
    };

    const renderTables = () => {
      const { report } = props;
      const options = report.tableOptions.value;
      if (options.length === 0) {
        return renderPending();
      }
      return (
        <ElSelect
          class={styles.control}
          aria-label="报表类型"
          modelValue={report.criteria.value.table}
          onUpdate:modelValue={(next: unknown) => {
            const option = options.find(item => item.value === next);
            if (option) {
              report.setTable(option.value);
            }
          }}
        >
          {options.map(option => (
            <ElOption key={option.value} label={option.label} value={option.value} />
          ))}
        </ElSelect>
      );
    };

    const renderLevels = () => {
      const { report } = props;
      const options = report.levelOptions.value;
      if (report.tableOptions.value.length === 0) {
        return renderPending();
      }
      return (
        <ElRadioGroup
          size="small"
          aria-label="行政区划"
          modelValue={report.criteria.value.level}
          onUpdate:modelValue={next => {
            const option = options.find(item => item.value === next);
            if (option) {
              report.setLevel(option.value);
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
      const { year, baseYear } = report.criteria.value;
      return (
        <MxPanel title="选择查看报表">
          <div class={styles.rows}>
            {/* 本底年份和监测年份排在一行：成对地读，换报表时面板的高度不变 */}
            <div class={styles.row}>
              <div class={styles.field}>
                <span class={styles.label}>监测年份</span>
                <ElDatePicker
                  class={styles.year}
                  type="year"
                  aria-label="监测年份"
                  modelValue={year}
                  valueFormat="YYYY"
                  format="YYYY年"
                  clearable={false}
                  onUpdate:modelValue={(value: string) => report.setYear(value)}
                />
              </div>
              {baseYear !== null && (
                <div class={styles.field}>
                  <span class={styles.label}>本底年份</span>
                  <ElDatePicker
                    class={styles.year}
                    type="year"
                    aria-label="本底年份"
                    modelValue={baseYear}
                    valueFormat="YYYY"
                    format="YYYY年"
                    clearable={false}
                    disabledDate={(date: Date) => !isBaseYearValid(year, String(date.getFullYear()))}
                    onUpdate:modelValue={(value: string) => report.setBaseYear(value)}
                  />
                </div>
              )}
            </div>
            <div class={styles.field}>
              <span class={styles.label}>报表类型</span>
              {renderTables()}
            </div>
            <div class={styles.field}>
              <span class={styles.label}>行政区划</span>
              {renderLevels()}
            </div>
          </div>
        </MxPanel>
      );
    };
  }
});
