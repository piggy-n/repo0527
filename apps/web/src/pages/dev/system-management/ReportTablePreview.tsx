import { COMPACT_MEDIA_QUERY } from '@yzt/ui';
import { useMediaQuery } from '@vueuse/core';
import { ElButton, ElTable, ElTableColumn, vLoading } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import { PrepareStatusText } from './ApplicationStatus';
import styles from './preview.module.scss';
import type { ReportSample } from './samples';
import type { DownloadFeedback } from './useSystemManagementDemo';

interface Row {
  row: ReportSample;
  $index: number;
}

/** 统计报表的表格：处理完成的报表才能下载 */
export const ReportTablePreview = defineComponent({
  name: 'ReportTablePreview',
  directives: { loading: vLoading },
  props: {
    rows: { type: Array as PropType<ReportSample[]>, required: true },
    firstSerial: { type: Number, required: true },
    downloadFeedback: { type: String as PropType<DownloadFeedback>, required: true },
    downloadPercent: { type: Function as PropType<(id: string) => number | undefined>, required: true },
    initialLoading: { type: Boolean, required: true },
    refreshing: { type: Boolean, required: true },
    error: { type: Boolean, required: true }
  },
  emits: {
    download: (_row: ReportSample) => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);
    const showSkeleton = useDelayedFlag(() => props.initialLoading);
    const showMask = useDelayedFlag(() => props.refreshing);

    function renderDownload(row: ReportSample) {
      const percent = props.downloadPercent(row.id);
      if (percent !== undefined && props.downloadFeedback === 'progress') {
        return <span class={styles.downloading}>下载 {percent}%</span>;
      }
      return (
        <ElButton
          link
          type="primary"
          loading={percent !== undefined}
          disabled={row.status !== 'success'}
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
            <ElTableColumn prop="year" label="年份" width="80" align="center" />,
            <ElTableColumn prop="name" label="报表名称" minWidth="200" showOverflowTooltip />,
            <ElTableColumn prop="startTime" label="开始时间" width="170" />,
            <ElTableColumn prop="finishTime" label="完成时间" width="170" />,
            <ElTableColumn label="状态" width="130">
              {{ default: ({ row }: Row) => <PrepareStatusText status={row.status} /> }}
            </ElTableColumn>,
            <ElTableColumn label="操作" width="110" align="center" fixed={compact.value ? false : 'right'}>
              {{ default: ({ row }: Row) => renderDownload(row) }}
            </ElTableColumn>
          ],
          empty: renderEmpty
        }}
      </ElTable>
    );
  }
});
