import { CircleCheck, CircleClose, Clock, Download, Refresh } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import {
  type Column,
  ElAutoResizer,
  ElButton,
  ElCheckTag,
  ElIcon,
  ElSkeleton,
  ElTableV2,
  ElTooltip,
  type TableV2Instance
} from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { StatisticsReport } from '../composables/useStatisticsReport';
import type { ReportRow } from '../report';
import { tableName, type TaskStatus } from '../statistics';
import styles from './ReportMonitorPanel.module.scss';

const STATUS_ICONS = { completed: CircleCheck, failed: CircleClose, processing: Refresh, notStarted: Clock } as const;

type TableSize = { readonly width: number; readonly height: number };

// Element 的单元格参数里 rowData 是 any，这里标上行的类型
type Cell = { readonly rowData: ReportRow };

// 单行文字，放不下时省略并在悬停时显示全文；没有值时显示 -
const text = (value: string | null, extra?: string) => (
  <span class={[styles.text, value === null && styles.empty, extra]} title={value ?? undefined}>
    {value ?? '-'}
  </span>
);

/**
 * 当前报表监控：数量标签兼作状态筛选（可多选，"共几个"回到全部），统计表多到几千张，用虚拟表格。
 * 去下载由页面决定能不能去、去哪里
 */
export const ReportMonitorPanel = defineComponent({
  name: 'ReportMonitorPanel',
  props: {
    report: { type: Object as PropType<StatisticsReport>, required: true },
    /** 不能下载时的原因；能下载时为 null */
    downloadBlocked: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    download: () => true
  },
  setup(props, { emit }) {
    const table = ref<TableV2Instance>();
    const showSkeleton = useDelayedFlag(() => props.report.loading.value);

    const columns = computed((): Column<ReportRow>[] => {
      const tableLabel = tableName(props.report.criteria.value.table);
      return [
        { key: 'year', title: '年份', width: 96, align: 'center', cellRenderer: ({ rowData }: Cell) => text(`${rowData.year}年`) },
        { key: 'region', title: '行政区划', width: 140, align: 'center', cellRenderer: ({ rowData }: Cell) => text(rowData.regionName) },
        { key: 'table', title: '报表类型', width: 140, align: 'center', cellRenderer: () => text(tableLabel) },
        {
          key: 'name',
          title: '报表名称',
          width: 220,
          flexGrow: 1,
          align: 'center',
          cellRenderer: ({ rowData }: Cell) => text(rowData.name)
        },
        {
          key: 'time',
          title: '处理时间',
          width: 190,
          align: 'center',
          cellRenderer: ({ rowData }: Cell) => text(rowData.completeTime)
        },
        {
          key: 'status',
          title: '状态',
          width: 132,
          align: 'center',
          cellRenderer: ({ rowData }: Cell) => {
            const Icon = STATUS_ICONS[rowData.status];
            return (
              <span class={[styles.status, styles[rowData.status]]}>
                <ElIcon class={rowData.status === 'processing' ? styles.spin : undefined}>
                  <Icon />
                </ElIcon>
                {rowData.statusText}
              </span>
            );
          }
        },
        {
          key: 'cause',
          title: '备注',
          width: 200,
          flexGrow: 1,
          align: 'center',
          cellRenderer: ({ rowData }: Cell) => text(rowData.cause, rowData.status === 'failed' ? styles.cause : undefined)
        }
      ];
    });

    const columnsWidth = computed(() => columns.value.reduce((total, column) => total + column.width, 0));

    const tags = computed(() => {
      const counts = props.report.status.value?.counts;
      const rows = props.report.status.value?.rows ?? [];
      const present = new Set(rows.map(row => row.status));
      const filter = props.report.statusFilter.value;
      const tag = (status: TaskStatus, label: string, count: number | undefined) => ({
        status,
        label: `${label}: ${count ?? 0}个`,
        checked: filter.has(status),
        // 已选中的即使数量清零也能取消
        disabled: !filter.has(status) && !present.has(status)
      });
      return {
        total: `共${counts?.total ?? 0}个报表`,
        all: rows.length > 0 && filter.size === 0,
        statuses: [
          tag('completed', '成功', counts?.completed),
          tag('failed', '失败', counts?.failed),
          tag('processing', '处理中', counts?.processing),
          tag('notStarted', '未处理', counts?.notStarted)
        ]
      };
    });

    // 换条件、换筛选、新一轮提交时回到顶部；轮询更新保留阅读位置
    watch(
      [() => props.report.criteria.value, () => props.report.statusFilter.value, () => props.report.run.value],
      () => table.value?.scrollToTop(0)
    );

    // 放得下全部列时按比例撑满，放不下时列宽固定、横向滚动
    const renderTable = ({ width, height }: TableSize) => (
      <ElTableV2
        ref={table}
        columns={columns.value}
        data={props.report.rows.value}
        width={width}
        height={height}
        fixed={width < columnsWidth.value}
        rowHeight={44}
        headerHeight={44}
      >
        {{
          empty: () => (
            <div class={styles.placeholder}>
              {props.report.statusFilter.value.size > 0 && (props.report.status.value?.rows.length ?? 0) > 0
                ? '当前筛选条件下暂无数据'
                : '当前条件暂无处理数据'}
            </div>
          )
        }}
      </ElTableV2>
    );

    return () => {
      const { report } = props;
      const current = tags.value;
      const download = (
        <ElButton type="primary" icon={Download} disabled={props.downloadBlocked !== null} onClick={() => emit('download')}>
          去下载
        </ElButton>
      );
      return (
        <MxPanel title="当前报表监控" flush class={styles.panel}>
          {{
            subheader: () => (
              <div class={styles.tags} role="group" aria-label="按状态筛选">
                <ElCheckTag checked={current.all} onChange={() => report.toggleStatus(null)}>
                  {current.total}
                </ElCheckTag>
                {current.statuses.map(item => (
                  <ElCheckTag
                    key={item.status}
                    checked={item.checked}
                    disabled={item.disabled}
                    type={item.status === 'failed' ? 'danger' : 'primary'}
                    onChange={() => report.toggleStatus(item.status)}
                  >
                    {item.label}
                  </ElCheckTag>
                ))}
              </div>
            ),
            actions: () => [
              props.downloadBlocked === null ? (
                download
              ) : (
                <ElTooltip content={props.downloadBlocked} placement="top">
                  <span>{download}</span>
                </ElTooltip>
              )
            ],
            default: () =>
              report.loading.value ? (
                showSkeleton.value && <ElSkeleton class={styles.skeleton} rows={5} animated />
              ) : (
                <div class={styles.table}>
                  <ElAutoResizer>{{ default: renderTable }}</ElAutoResizer>
                </div>
              )
          }}
        </MxPanel>
      );
    };
  }
});
