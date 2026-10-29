import { COMPACT_MEDIA_QUERY } from '@yzt/ui';
import { useMediaQuery } from '@vueuse/core';
import { ElTable, ElTableColumn, vLoading } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { isPrepareStatus } from '@/shared/data-request/prepare-status';
import { PrepareStatusText } from '@/shared/data-request/PrepareStatusText';
import { DownloadButton } from '@/shared/file-transfer/DownloadButton';
import type { RowDownloadState } from '@/shared/file-transfer/useRowDownloads';
import { TableLoadError } from '@/shared/table/TableLoadError';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import type { Report } from '../api';
import styles from './ReportTable.module.scss';

interface Row {
  row: Report;
  $index: number;
}

// 认得的状态显示图标和文案，其他的原样显示（没有真实样本，见 api.ts）
function renderStatus(report: Report) {
  return isPrepareStatus(report.status) ? <PrepareStatusText status={report.status} /> : report.status;
}

/** 统计报表的表格：占满父元素的剩余高度；状态认得的显示图标和文案，其他的原样显示；处理完成的才能下载 */
export const ReportTable = defineComponent({
  name: 'ReportTable',
  directives: { loading: vLoading },
  props: {
    reports: { type: Array as PropType<Report[]>, required: true },
    // 第一行的序号，翻页后接着上一页往下数
    firstSerial: { type: Number, required: true },
    // 两种加载状态见 docs/modules/table.md
    initialLoading: { type: Boolean, required: true },
    refreshing: { type: Boolean, required: true },
    error: { type: Boolean, required: true },
    downloads: { type: Object as PropType<RowDownloadState>, required: true }
  },
  emits: {
    retry: () => true,
    download: (_report: Report) => true
  },
  setup(props, { emit }) {
    // 骨架屏和遮罩都延迟显示：请求很快完成时什么都不出现，避免一闪而过
    const showSkeleton = useDelayedFlag(() => props.initialLoading);
    const showMask = useDelayedFlag(() => props.refreshing);
    // 窄屏随表格滚动，避免固定的操作列盖住报表名称
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);

    function renderEmpty() {
      if (showSkeleton.value) {
        return <TableSkeleton />;
      }
      // 骨架屏出现之前表体留空，不显示"暂无数据"
      if (props.initialLoading) {
        return '';
      }
      if (props.error) {
        return <TableLoadError onRetry={() => emit('retry')} />;
      }
      return '暂无数据';
    }

    return () => (
      <ElTable class={styles.root} data={props.reports} height="100%" rowKey="id" v-loading={showMask.value}>
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
              {{ default: ({ row }: Row) => renderStatus(row) }}
            </ElTableColumn>,
            <ElTableColumn label="操作" width="110" align="center" fixed={compact.value ? false : 'right'}>
              {{
                default: ({ row }: Row) => (
                  <DownloadButton
                    downloading={props.downloads.isDownloading(row.id)}
                    percent={props.downloads.percentOf(row.id)}
                    disabled={row.status !== 'success'}
                    onClick={() => emit('download', row)}
                  />
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
