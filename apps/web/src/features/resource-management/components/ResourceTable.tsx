import { ElAlert, ElButton, ElTable, ElTableColumn, ElTag, vLoading } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import type { ResourceRecord } from '../api';
import { ResourceStatusSwitch } from './ResourceStatusSwitch';
import styles from './ResourceManagement.module.scss';

/** 资源列表的加载、详情与启停入口；开关的真实值仍由查询缓存持有 */
export const ResourceTable = defineComponent({
  name: 'ResourceTable',
  directives: { loading: vLoading },
  props: {
    rows: { type: Array as PropType<ResourceRecord[]>, required: true },
    initialLoading: Boolean,
    refreshing: Boolean,
    error: Boolean,
    selected: Boolean,
    statusPending: { type: Function as PropType<(id: string) => boolean>, required: true }
  },
  emits: { retry: () => true, view: (_row: ResourceRecord) => true, toggle: (_row: ResourceRecord) => true },
  setup(props, { emit }) {
    const showSkeleton = useDelayedFlag(() => props.initialLoading);
    const showMask = useDelayedFlag(() => props.refreshing);
    return () => (
      <>
        {props.error && props.rows.length > 0 && (
          <ElAlert type="error" closable={false} class={styles.notice}>
            刷新失败，以下为上次结果。
            <ElButton link type="primary" onClick={() => emit('retry')}>重试列表</ElButton>
          </ElAlert>
        )}
        <ElTable class={styles.table} data={props.rows} height="100%" v-loading={showMask.value}>
          {{
            default: () => [
              <ElTableColumn prop="name" label="资源名称" minWidth="240" showOverflowTooltip />,
              <ElTableColumn prop="year" label="年份" width="80" align="center" />,
              <ElTableColumn prop="datasetName" label="所属数据集" minWidth="170" showOverflowTooltip />,
              <ElTableColumn label="切片" width="80" align="center">
                {{ default: ({ row }: { row: ResourceRecord }) =>
                  <ElTag type={row.hasSlice ? 'success' : 'info'}>{row.hasSlice ? '有' : '无'}</ElTag> }}
              </ElTableColumn>,
              <ElTableColumn label="启用状态" width="130" align="center">
                {{ default: ({ row }: { row: ResourceRecord }) =>
                  <ResourceStatusSwitch
                    row={row}
                    pending={props.statusPending(row.id)}
                    disabled={props.error || props.refreshing}
                    onToggle={() => emit('toggle', row)}
                  /> }}
              </ElTableColumn>,
              <ElTableColumn label="操作" width="90" fixed="right" align="center">
                {{ default: ({ row }: { row: ResourceRecord }) =>
                  <ElButton link type="primary" onClick={() => emit('view', row)}>查看</ElButton> }}
              </ElTableColumn>
            ],
            empty: () => {
              if (showSkeleton.value) { return <TableSkeleton />; }
              if (props.initialLoading) { return ''; }
              if (props.error) {
                return <div class={styles.state}>资源列表加载失败
                  <ElButton link type="primary" onClick={() => emit('retry')}>重试列表</ElButton>
                </div>;
              }
              return props.selected ? '暂无资源，可调整筛选条件后查询' : '请先加载并选择资源目录';
            }
          }}
        </ElTable>
      </>
    );
  }
});
