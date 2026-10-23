import { COMPACT_MEDIA_QUERY } from '@yzt/ui';
import { useMediaQuery } from '@vueuse/core';
import { ElButton, ElTable, ElTableColumn, ElTag, vLoading } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import type { SystemRow, SystemSection } from '../api';
import { auditLabels, auditTypes, canDownload, downloadTarget, rowId, rowName, taskLabel } from '../presentation';
import styles from './system-management.module.scss';

type RowSlot = { row: SystemRow; $index: number };

/** 两类列表共用状态与操作列，业务字段保持分开 */
export const SystemTable = defineComponent({
  name: 'SystemTable',
  directives: { loading: vLoading },
  props: {
    section: { type: String as PropType<SystemSection>, required: true },
    rows: { type: Array as PropType<SystemRow[]>, required: true },
    offset: { type: Number, required: true },
    initialLoading: Boolean,
    refreshing: Boolean,
    failed: Boolean,
    isDownloading: { type: Function as PropType<(id: string) => boolean>, required: true }
  },
  emits: {
    open: (_id: string) => true,
    download: (_row: SystemRow) => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);
    const skeleton = useDelayedFlag(() => props.initialLoading);
    const mask = useDelayedFlag(() => props.refreshing);

    function renderEmpty() {
      if (props.initialLoading) {
        return skeleton.value ? <TableSkeleton /> : '';
      }
      if (props.failed) {
        return <div>加载失败 <ElButton link type="primary" onClick={() => emit('retry')}>重试</ElButton></div>;
      }
      return '暂无符合条件的数据';
    }

    return () => (
      <ElTable data={props.rows} rowKey={rowId} height="100%" class={styles.table} v-loading={mask.value}>
        {{
          default: () => [
            <ElTableColumn label="序号" width="64" align="center">
              {{ default: ({ $index }: RowSlot) => props.offset + $index + 1 }}
            </ElTableColumn>,
            props.section === 'reports' && <ElTableColumn prop="year" label="年份" width="64" />,
            <ElTableColumn label="数据名称" minWidth="220" showOverflowTooltip>
              {{ default: ({ row }: RowSlot) => rowName(row) }}
            </ElTableColumn>,
            props.section === 'audit' && (
              <ElTableColumn prop="xzqmc" label="行政区划" width="96" showOverflowTooltip />
            ),
            props.section === 'reports' && (
              <ElTableColumn prop="startTime" label="开始时间" width="170" showOverflowTooltip />
            ),
            <ElTableColumn
              prop={props.section === 'audit' ? 'create_time' : 'finishTime'}
              label={props.section === 'audit' ? '申请时间' : '完成时间'}
              width="170"
              showOverflowTooltip
            />,
            props.section === 'audit' && (
              <ElTableColumn label="审核状态" width="112">
                {{ default: ({ row }: RowSlot) => row.kind === 'audit' && (
                  <ElTag type={auditTypes[row.status]}>{auditLabels[row.status]}</ElTag>
                ) }}
              </ElTableColumn>
            ),
            <ElTableColumn label="数据准备状态" width="112" showOverflowTooltip>
              {{ default: ({ row }: RowSlot) => taskLabel(row.kind === 'audit' ? row.storage_status : row.status) }}
            </ElTableColumn>,
            <ElTableColumn label="操作" width="120" align="center" fixed={compact.value ? false : 'right'}>
              {{ default: ({ row }: RowSlot) => (
                <div class={styles.actions}>
                  {row.kind === 'audit' && (
                    <ElButton
                      link
                      type="primary"
                      disabled={row.status === 'table'}
                      onClick={() => emit('open', row.apply_id)}
                    >
                      {row.status === 'pending' ? '审核' : '查看'}
                    </ElButton>
                  )}
                  <ElButton
                    link
                    type="primary"
                    disabled={!canDownload(row) || props.isDownloading(downloadTarget(row).id)}
                    onClick={() => emit('download', row)}
                  >
                    下载
                  </ElButton>
                </div>
              ) }}
            </ElTableColumn>
          ],
          empty: renderEmpty
        }}
      </ElTable>
    );
  }
});
