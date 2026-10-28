import { ArrowDown, ArrowUp, FullScreen, Loading, Refresh, ScaleToOriginal } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElIcon, ElMessage, ElProgress, ElTable, ElTableColumn, ElTag } from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import {
  CALCULATION_ROW_LABELS,
  type CalculationRow,
  type CalculationRowStatus,
  type CalculationTask,
  calculationCounts,
  calculationRows,
  calculationStatusText
} from '../calculation';
import type { IndicatorCalculation } from '../composables/useIndicatorCalculation';
import { indicatorResultValue } from '../indicator-tree';
import styles from './CalculationProgressPanel.module.scss';

const ROW_TAGS: Readonly<Record<CalculationRowStatus, 'info' | 'primary' | 'success' | 'danger'>> = {
  pending: 'info',
  processing: 'primary',
  completed: 'success',
  failed: 'danger'
};

interface Row {
  row: CalculationRow;
}

const renderStatus = ({ row }: Row) => (
  <ElTag type={ROW_TAGS[row.status]} size="small" disableTransitions>
    <span class={styles.status}>
      {row.status === 'processing' && (
        <ElIcon class="is-loading">
          <Loading />
        </ElIcon>
      )}
      {CALCULATION_ROW_LABELS[row.status]}
    </span>
  </ElTag>
);

const renderResult = ({ row }: Row) =>
  row.result !== null && <span class={styles.result}>{indicatorResultValue(row.result)}</span>;

/**
 * 数据处理进度（计算页签，地图底部）：这次计算的条件、数量与进度条、每个指标的状态和结果。
 * 可以收起成标题行或最大化到地图区域的高度；进度连续失败停下后在标题栏重新获取
 */
export const CalculationProgressPanel = defineComponent({
  name: 'CalculationProgressPanel',
  props: {
    calculation: { type: Object as PropType<IndicatorCalculation>, required: true }
  },
  setup(props) {
    const collapsed = ref(false);
    const maximized = ref(false);
    const task = computed(() => props.calculation.task.value);
    const rows = computed(() => (task.value === null ? [] : calculationRows(task.value)));
    const counts = computed(() => calculationCounts(rows.value));

    // 新的任务开始时展开、恢复常规高度
    watch(
      () => task.value?.request,
      () => {
        collapsed.value = false;
        maximized.value = false;
      }
    );
    // 连续失败停下时提示一次（同旧页面），面板里另有状态和重新获取
    watch(
      () => task.value?.phase,
      phase => {
        if (phase === 'stalled') {
          ElMessage.error('进度获取连续失败，请点击重新获取进度');
        }
      }
    );

    const renderBody = (current: CalculationTask) => {
      const { total, processing, completed, failed } = counts.value;
      return (
        <div class={styles.body}>
          <dl class={styles.summary}>
            <div>
              <dt>计算年份</dt>
              <dd>{current.request.year}年</dd>
            </div>
            <div>
              <dt>监测范围</dt>
              <dd>{current.request.regionName}</dd>
            </div>
            <div class={styles.wide}>
              <dt>当前状态</dt>
              <dd class={current.phase === 'failed' || current.phase === 'stalled' ? styles.danger : undefined}>
                {calculationStatusText(current)}
              </dd>
            </div>
          </dl>
          <div class={styles.counts}>
            <span>
              {total}个指标，{processing}个正在计算，{completed}个已完成，{failed}个计算失败
            </span>
            <ElProgress class={styles.progress} percentage={current.progress?.percent ?? 0} strokeWidth={8} />
          </div>
          <ElTable class={styles.table} data={rows.value} height="100%" rowKey="code">
            <ElTableColumn label="序号" type="index" width="64" align="center" />
            <ElTableColumn prop="name" label="指标名称" minWidth="200" showOverflowTooltip />
            <ElTableColumn label="状态" width="120">
              {{ default: renderStatus }}
            </ElTableColumn>
            <ElTableColumn label="计算结果" minWidth="120" showOverflowTooltip>
              {{ default: renderResult }}
            </ElTableColumn>
          </ElTable>
        </div>
      );
    };

    return () => {
      const current = task.value;
      if (current === null) {
        return null;
      }
      return (
        <MxPanel
          floating
          headerTone="muted"
          flush
          title="数据处理进度"
          class={[styles.panel, collapsed.value && styles.collapsed, maximized.value && styles.maximized]}
          data-calculation-progress
        >
          {{
            actions: () => (
              <>
                {current.phase === 'stalled' && (
                  <ElButton type="primary" size="small" icon={Refresh} onClick={props.calculation.retryProgress}>
                    重新获取进度
                  </ElButton>
                )}
                {!collapsed.value && (
                  <ElButton
                    link
                    icon={maximized.value ? ScaleToOriginal : FullScreen}
                    aria-label={maximized.value ? '还原数据处理进度' : '最大化数据处理进度'}
                    onClick={() => (maximized.value = !maximized.value)}
                  />
                )}
                <ElButton
                  link
                  icon={collapsed.value ? ArrowUp : ArrowDown}
                  aria-label={collapsed.value ? '展开数据处理进度' : '收起数据处理进度'}
                  aria-expanded={!collapsed.value}
                  onClick={() => (collapsed.value = !collapsed.value)}
                />
              </>
            ),
            default: () => (collapsed.value ? null : renderBody(current))
          }}
        </MxPanel>
      );
    };
  }
});
