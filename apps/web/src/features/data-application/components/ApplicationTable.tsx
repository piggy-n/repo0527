import { COMPACT_MEDIA_QUERY } from '@yzt/ui';
import { useMediaQuery } from '@vueuse/core';
import { ElButton, ElTable, ElTableColumn, vLoading } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { PrepareStatusText } from '@/shared/data-request/PrepareStatusText';
import { DownloadButton } from '@/shared/file-transfer/DownloadButton';
import type { RowDownloadState } from '@/shared/file-transfer/useRowDownloads';
import { TableLoadError } from '@/shared/table/TableLoadError';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import type { Application } from '../api';
import { canDownload, hasPrepareStep } from '../status';
import { AuditStatusTag } from './ApplicationStatus';
import styles from './ApplicationTable.module.scss';

interface Row {
  row: Application;
  $index: number;
}

/**
 * 申请表格（管理员审核用）：占满父元素的剩余高度；没有值的单元格由表格的全局样式显示"-"。
 * 待审核的"审核"，其余"查看"；统计任务没有申请的字段，不能查看。有数据准备这一步的才有下载，准备完成才能点（ADR 0092）
 */
export const ApplicationTable = defineComponent({
  name: 'ApplicationTable',
  directives: { loading: vLoading },
  props: {
    applications: { type: Array as PropType<Application[]>, required: true },
    // 第一行的序号，翻页后接着上一页往下数
    firstSerial: { type: Number, required: true },
    // 两种加载状态见 docs/modules/table.md：没有数据时显示骨架屏，显示着旧数据时显示遮罩
    initialLoading: { type: Boolean, required: true },
    refreshing: { type: Boolean, required: true },
    error: { type: Boolean, required: true },
    downloads: { type: Object as PropType<RowDownloadState>, required: true }
  },
  emits: {
    retry: () => true,
    open: (_application: Application) => true,
    download: (_application: Application) => true
  },
  setup(props, { emit }) {
    // 骨架屏和遮罩都延迟显示：请求很快完成时什么都不出现，避免一闪而过
    const showSkeleton = useDelayedFlag(() => props.initialLoading);
    const showMask = useDelayedFlag(() => props.refreshing);
    // 窄屏随表格滚动，避免固定的操作列盖住数据名称
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);

    function renderOpen(application: Application) {
      if (application.status === 'table') {
        return null;
      }
      return (
        <ElButton link type="primary" onClick={() => emit('open', application)}>
          {application.status === 'pending' ? '审核' : '查看'}
        </ElButton>
      );
    }

    function renderDownload(application: Application) {
      if (!hasPrepareStep(application)) {
        return null;
      }
      return (
        <DownloadButton
          downloading={props.downloads.isDownloading(application.id)}
          percent={props.downloads.percentOf(application.id)}
          disabled={!canDownload(application)}
          onClick={() => emit('download', application)}
        />
      );
    }

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
      <ElTable class={styles.root} data={props.applications} height="100%" rowKey="id" v-loading={showMask.value}>
        {{
          default: () => [
            <ElTableColumn label="序号" width="64" align="center">
              {{ default: ({ $index }: Row) => props.firstSerial + $index }}
            </ElTableColumn>,
            <ElTableColumn prop="name" label="数据名称" minWidth="200" showOverflowTooltip />,
            <ElTableColumn prop="applicant" label="申请人" width="100" showOverflowTooltip />,
            <ElTableColumn prop="region" label="行政区划" minWidth="140" showOverflowTooltip />,
            <ElTableColumn prop="appliedAt" label="申请时间" width="170" />,
            <ElTableColumn label="审核状态" width="110">
              {{ default: ({ row }: Row) => <AuditStatusTag status={row.status} /> }}
            </ElTableColumn>,
            <ElTableColumn label="数据准备状态" width="130">
              {{ default: ({ row }: Row) => hasPrepareStep(row) && <PrepareStatusText status={row.prepare} /> }}
            </ElTableColumn>,
            <ElTableColumn label="操作" width="140" align="center" fixed={compact.value ? false : 'right'}>
              {{
                // 固定两格：各行的"审核 / 查看"和下载上下对齐
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
