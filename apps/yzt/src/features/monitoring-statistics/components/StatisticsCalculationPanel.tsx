import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElCheckbox, ElDatePicker, ElMessage, ElMessageBox } from 'element-plus';
import { defineComponent, h, onBeforeUnmount, type PropType } from 'vue';
import type { CalculationEntry, StatisticsCalculation } from '../composables/useStatisticsCalculation';
import {
  BASE_YEAR_KINDS,
  BASE_YEAR_LABELS,
  type BaseYearKind,
  isBaseYearValid,
  levelLabel,
  tableLevelKey,
  TABLES,
  tableName
} from '../statistics';
import styles from './StatisticsCalculationPanel.module.scss';

// 确认框里最多列出几项已有任务的组合（同旧页面）
const CONFIRM_LIST_LIMIT = 8;

const describeEntry = ({ table, level, baseYear }: CalculationEntry) =>
  [tableName(table), levelLabel(level, table), ...(baseYear === null ? [] : [`本底${baseYear}年`])].join(' / ');

// 确认框的内容：没有已有任务时一句话；有时逐条列出，说明会覆盖原有结果，有处理中的另外提醒
function confirmMessage(entries: readonly CalculationEntry[]) {
  const existing = entries.filter(entry => entry.status !== 'notStarted');
  if (existing.length === 0) {
    return `本次将提交 ${entries.length} 项统计分析任务，是否继续？`;
  }
  const unknown = existing.filter(entry => entry.status === 'unknown').length;
  const rest = existing.length - CONFIRM_LIST_LIMIT;
  return h('div', { class: styles.confirm }, [
    h('p', [
      `本次将提交 ${entries.length} 项，其中 `,
      h('strong', `${unknown > 0 ? unknown : existing.length} 项`),
      unknown > 0
        ? '状态未能确认，可能已有结果或正在执行；继续可能重新统计并覆盖原有结果：'
        : '已有统计任务，继续将重新统计并覆盖原有结果：'
    ]),
    h(
      'ul',
      { class: styles.confirmList },
      existing.slice(0, CONFIRM_LIST_LIMIT).map(entry =>
        h('li', { key: tableLevelKey(entry) }, [
          h('span', describeEntry(entry)),
          h('span', { class: [styles.confirmStatus, styles[entry.status]] }, entry.statusText)
        ])
      )
    ),
    rest > 0 && h('p', { class: styles.muted }, `另有 ${rest} 项未在此列出`),
    existing.some(entry => entry.status === 'processing') &&
      h('p', { class: styles.warning }, '其中包含正在处理的项目，重新提交可能会打断当前进度。'),
    h('p', '是否继续？')
  ]);
}

/**
 * 统计报表计算（左栏）：监测年度、两个本底年度（默认上一年，只能选更早的年份）、按报表和等级勾选，提交前确认已有任务的组合。
 * 变化类报表在名称右边写用哪个本底年度。
 * 收起由布局负责（MxSplitLayout 的 collapsible）
 */
export const StatisticsCalculationPanel = defineComponent({
  name: 'StatisticsCalculationPanel',
  props: {
    calculation: { type: Object as PropType<StatisticsCalculation>, required: true }
  },
  setup(props) {
    // ElMessageBox 不随组件卸载关闭：卸载时关掉本组件打开的确认框；它只能一次关闭全部，所以只在有打开的时调用
    let openConfirms = 0;
    onBeforeUnmount(() => {
      if (openConfirms > 0) {
        ElMessageBox.close();
      }
    });

    const confirm = async (entries: readonly CalculationEntry[]) => {
      openConfirms++;
      try {
        await ElMessageBox.confirm(confirmMessage(entries), '确认开始统计分析？', {
          type: 'warning',
          confirmButtonText: '确认开始',
          cancelButtonText: '取消'
        });
        return true;
      } catch {
        return false;
      } finally {
        openConfirms--;
      }
    };

    const submit = async () => {
      const outcome = await props.calculation.submit(confirm);
      if (outcome.kind === 'rejected') {
        ElMessage.error(outcome.message);
      } else if (outcome.kind === 'uncertain') {
        ElMessage.warning('提交响应未确认，正在查询任务状态，请勿重复提交');
      }
    };

    const renderBaseYear = (kind: BaseYearKind) => {
      const { calculation } = props;
      return (
        <div key={kind} class={styles.field}>
          <span class={styles.label}>{BASE_YEAR_LABELS[kind]}年度</span>
          <ElDatePicker
            class={styles.control}
            type="year"
            modelValue={calculation.baseYears.value[kind]}
            valueFormat="YYYY"
            format="YYYY年"
            clearable={false}
            disabled={calculation.submitting.value}
            disabledDate={(date: Date) => !isBaseYearValid(calculation.year.value, String(date.getFullYear()))}
            onUpdate:modelValue={(value: string) => calculation.setBaseYear(kind, value)}
          />
        </div>
      );
    };

    return () => {
      const { calculation } = props;
      const submitting = calculation.submitting.value;
      const all = calculation.allState.value;
      return (
        <MxPanel title="统计报表计算" class={styles.panel}>
          {{
            default: () => (
              <div class={styles.body}>
                <section class={styles.section}>
                  <MxTitle>年份选择</MxTitle>
                  <div class={styles.field}>
                    <span class={styles.label}>监测数据年度</span>
                    <ElDatePicker
                      class={styles.control}
                      type="year"
                      modelValue={calculation.year.value}
                      valueFormat="YYYY"
                      format="YYYY年"
                      clearable={false}
                      disabled={submitting}
                      onUpdate:modelValue={(value: string) => calculation.setYear(value)}
                    />
                  </div>
                  {BASE_YEAR_KINDS.map(renderBaseYear)}
                </section>
                <section class={styles.section}>
                  <MxTitle>
                    {{
                      default: () => '选择表',
                      extra: () => [
                        <ElCheckbox
                          modelValue={all.checked}
                          indeterminate={all.indeterminate}
                          disabled={submitting}
                          onChange={value => calculation.toggleAll(value === true)}
                        >
                          全选
                        </ElCheckbox>
                      ]
                    }}
                  </MxTitle>
                  {TABLES.map(table => {
                    const state = calculation.tableState(table.type);
                    return (
                      <article key={table.type} class={styles.group}>
                        <div class={styles.groupHeader}>
                          <ElCheckbox
                            modelValue={state.checked}
                            indeterminate={state.indeterminate}
                            disabled={submitting}
                            onChange={value => calculation.toggleTable(table.type, value === true)}
                          >
                            {table.name}
                          </ElCheckbox>
                          {table.baseYear !== null && (
                            <span class={styles.baseYear}>
                              {BASE_YEAR_LABELS[table.baseYear]} {calculation.baseYears.value[table.baseYear]}年
                            </span>
                          )}
                        </div>
                        <div class={styles.levels}>
                          {table.levels.map(level => (
                            <ElCheckbox
                              key={level}
                              modelValue={calculation.selected.value.has(tableLevelKey({ table: table.type, level }))}
                              disabled={submitting}
                              onChange={value => calculation.toggle({ table: table.type, level }, value === true)}
                            >
                              {levelLabel(level, table.type)}
                            </ElCheckbox>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </section>
              </div>
            ),
            footer: () => (
              <ElButton
                type="primary"
                class={styles.submit}
                loading={submitting}
                disabled={!calculation.canStart.value || submitting}
                onClick={submit}
              >
                开始统计分析
              </ElButton>
            )
          }}
        </MxPanel>
      );
    };
  }
});
