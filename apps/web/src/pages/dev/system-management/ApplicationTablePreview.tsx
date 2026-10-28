import { COMPACT_MEDIA_QUERY } from '@yzt/ui';
import { useMediaQuery } from '@vueuse/core';
import { ElButton, ElTable, ElTableColumn, vLoading } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import { AuditStatusTag, hasPrepareStep, PrepareStatusText } from './ApplicationStatus';
import styles from './preview.module.scss';
import type { ApplicationSample } from './samples';
import type { DownloadFeedback, TableRowMode } from './useSystemManagementDemo';

interface Row {
  row: ApplicationSample;
  $index: number;
}

/** 资源审核的表格：待审核的"审核"，其余"查看"；审核通过、准备完成的才能下载 */
export const ApplicationTablePreview = defineComponent({
  name: 'ApplicationTablePreview',
  directives: { loading: vLoading },
  props: {
    rows: { type: Array as PropType<ApplicationSample[]>, required: true },
    firstSerial: { type: Number, required: true },
    showApplicant: { type: Boolean, required: true },
    tableRowMode: { type: String as PropType<TableRowMode>, required: true },
    downloadFeedback: { type: String as PropType<DownloadFeedback>, required: true },
    downloadPercent: { type: Function as PropType<(id: string) => number | undefined>, required: true },
    initialLoading: { type: Boolean, required: true },
    refreshing: { type: Boolean, required: true },
    error: { type: Boolean, required: true }
  },
  emits: {
    open: (_row: ApplicationSample) => true,
    download: (_row: ApplicationSample) => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);
    const showSkeleton = useDelayedFlag(() => props.initialLoading);
    const showMask = useDelayedFlag(() => props.refreshing);

    function renderOpen(row: ApplicationSample) {
      if (row.status === 'table') {
        // 统计任务没有申请的字段，旧页面的"查看"是置灰的
        return props.tableRowMode === 'legacy' ? <span class={styles.disabledAction}>查看</span> : null;
      }
      return (
        <ElButton link type="primary" onClick={() => emit('open', row)}>
          {row.status === 'pending' ? '审核' : '查看'}
        </ElButton>
      );
    }

    function renderDownload(row: ApplicationSample) {
      if (!hasPrepareStep(row)) {
        return null;
      }
      const percent = props.downloadPercent(row.id);
      if (percent !== undefined && props.downloadFeedback === 'progress') {
        return <span class={styles.downloading}>下载 {percent}%</span>;
      }
      return (
        <ElButton
          link
          type="primary"
          loading={percent !== undefined}
          disabled={row.prepare !== 'success'}
          onClick={() => emit('download', row)}
        >
          下载
        </ElButton>
      );
    }

    function renderEmpty() {
      if (showSkeleton.value) {
        return <TableSkeleton />;
      }
      if (props.initialLoading) {
        return '';
      }
      if (props.error) {
        return (
          <div class={styles.error}>
            加载失败
            <ElButton link type="primary" onClick={() => emit('retry')}>
              重试
            </ElButton>
          </div>
        );
      }
      return '暂无数据';
    }

    return () => (
      <ElTable class={styles.table} data={props.rows} height="100%" rowKey="id" v-loading={showMask.value}>
        {{
          default: () => [
            <ElTableColumn label="序号" width="64" align="center">
              {{ default: ({ $index }: Row) => props.firstSerial + $index }}
            </ElTableColumn>,
            <ElTableColumn prop="name" label="数据名称" minWidth="200" showOverflowTooltip />,
            props.showApplicant && <ElTableColumn prop="applicant" label="申请人" width="100" />,
            <ElTableColumn prop="region" label="行政区划" minWidth="140" showOverflowTooltip />,
            <ElTableColumn prop="appliedAt" label="申请时间" width="170" />,
            <ElTableColumn label="审核状态" width="110">
              {{ default: ({ row }: Row) => <AuditStatusTag row={row} tableRowMode={props.tableRowMode} /> }}
            </ElTableColumn>,
            <ElTableColumn label="数据准备状态" width="130">
              {{ default: ({ row }: Row) => hasPrepareStep(row) && <PrepareStatusText status={row.prepare} /> }}
            </ElTableColumn>,
            <ElTableColumn label="操作" width="140" align="center" fixed={compact.value ? false : 'right'}>
              {{
                // 固定两格：各行的"审核 / 查看"和"下载"上下对齐
                default: ({ row }: Row) => (
                  <div class={styles.actions}>
                    <span>{renderOpen(row)}</span>
                    <span>{renderDownload(row)}</span>
                  </div>
                )
              }}
            </ElTableColumn>
          ],
          empty: renderEmpty
        }}
      </ElTable>
    );
  }
});
