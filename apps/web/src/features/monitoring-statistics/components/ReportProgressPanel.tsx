import { CircleCheck, CircleClose, Clock, Loading, Refresh, RefreshRight } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElIcon, ElProgress } from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import type { ReportActivity, StatisticsReport } from '../composables/useStatisticsReport';
import { settledRatio } from '../report';
import styles from './ReportProgressPanel.module.scss';

const ACTIVITY_TEXT: Readonly<Record<ReportActivity, string>> = {
  submitting: '统计请求提交中...',
  waiting: '正在等待任务生成...',
  confirming: '正在确认任务状态...',
  processing: '正在统计...',
  querying: '正在查询...'
};

/** 当前报表进度：已处理比例（成功和失败都算）、四个数量、轮询状态和提示；刷新同时更新总览 */
export const ReportProgressPanel = defineComponent({
  name: 'ReportProgressPanel',
  props: {
    report: { type: Object as PropType<StatisticsReport>, required: true }
  },
  emits: {
    refresh: () => true
  },
  setup(props, { emit }) {
    const counts = computed(() => props.report.status.value?.counts ?? null);
    const ratio = computed(() => (counts.value === null ? null : settledRatio(counts.value)));
    const stats = computed(() => {
      const value = counts.value;
      return [
        { key: 'completed', label: '成功', icon: CircleCheck, count: value?.completed ?? 0 },
        { key: 'failed', label: '失败', icon: CircleClose, count: value?.failed ?? 0 },
        { key: 'processing', label: '处理中', icon: Refresh, count: value?.processing ?? 0 },
        { key: 'notStarted', label: '未处理', icon: Clock, count: value?.notStarted ?? 0 }
      ] as const;
    });

    return () => {
      const { report } = props;
      const notice = report.notice.value;
      const percent = ratio.value === null ? null : Math.round(ratio.value * 10000) / 100;
      return (
        <MxPanel title="当前报表进度">
          {{
            // 查询中和更新时间常在同一轮里一起变，带 key 免得两个 span 按顺序互换
            actions: () => [
              report.polling.value && (
                <span key="activity" class={[styles.meta, styles.active]} role="status">
                  <ElIcon class={styles.spin}>
                    <Loading />
                  </ElIcon>
                  {ACTIVITY_TEXT[report.activity.value]}
                </span>
              ),
              report.updatedAt.value !== null && (
                <span key="updated" class={styles.meta}>
                  {report.updatedAt.value} 更新
                </span>
              ),
              <ElButton key="refresh" icon={RefreshRight} onClick={() => emit('refresh')}>
                刷新
              </ElButton>
            ],
            default: () => (
              <div class={styles.body}>
                <div class={styles.summary}>
                  <ElProgress
                    type="circle"
                    width={120}
                    strokeWidth={12}
                    percentage={percent ?? 0}
                    aria-label="完成度"
                  >
                    {{
                      default: () => (
                        <span class={styles.ring}>
                          <span class={[styles.percent, percent === null && styles.muted]}>
                            {percent === null ? '—' : `${percent}%`}
                          </span>
                          <span class={styles.unit}>完成度</span>
                        </span>
                      )
                    }}
                  </ElProgress>
                  <ul class={styles.stats}>
                    {stats.value.map(item => (
                      <li key={item.key} class={[styles.stat, styles[item.key]]}>
                        <ElIcon class={styles.statIcon}>
                          <item.icon />
                        </ElIcon>
                        <span class={styles.statLabel}>{item.label}</span>
                        <span class={styles.statCount}>{item.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {notice !== null && (
                  <div class={[styles.notice, styles[notice.type]]}>
                    <span>{notice.text}</span>
                    {notice.retry && (
                      <ElButton link type="primary" onClick={report.retry}>
                        重新查询
                      </ElButton>
                    )}
                  </div>
                )}
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
