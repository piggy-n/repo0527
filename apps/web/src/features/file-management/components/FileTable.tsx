import { ElButton, ElMessage, ElMessageBox, ElTable, ElTableColumn, ElTag, vLoading } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { ApiError } from '@/shared/http/errors';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import type { FileRecord } from '../api';
import { useDeleteFileMutation } from '../queries';
import styles from './FileTable.module.scss';

/** 文件表格：占满父元素的剩余高度；删除需要确认，成功后列表由查询缓存自动刷新 */
export const FileTable = defineComponent({
  name: 'FileTable',
  // TSX 中的指令按名字查找已注册的指令，局部注册即可，不做全局注册
  directives: { loading: vLoading },
  props: {
    files: { type: Array as PropType<FileRecord[]>, required: true },
    // 两种加载状态见 docs/modules/table.md：没有数据时显示骨架屏，显示着旧数据时显示遮罩
    initialLoading: { type: Boolean, required: true },
    refreshing: { type: Boolean, required: true },
    error: { type: Boolean, required: true }
  },
  emits: {
    retry: () => true
  },
  setup(props, { emit }) {
    const removal = useDeleteFileMutation();
    // 骨架屏和遮罩都延迟显示：请求很快完成时什么都不出现，避免一闪而过
    const showSkeleton = useDelayedFlag(() => props.initialLoading);
    const showMask = useDelayedFlag(() => props.refreshing);

    async function remove(file: FileRecord) {
      try {
        await ElMessageBox.confirm(`确定删除"${file.name}"吗？删除后不能恢复。`, '删除文件', {
          type: 'warning',
          confirmButtonText: '删除'
        });
      } catch {
        // 点了取消或关闭
        return;
      }
      try {
        await removal.mutateAsync(file.id);
      } catch (error) {
        // 失败原因已由全局提示显示（例如"文件不存在"）
        if (error instanceof ApiError) {
          return;
        }
        throw error;
      }
      ElMessage.success('删除成功');
    }

    // 删除进行中的那一行，按钮显示加载状态
    const isRemoving = (file: FileRecord) => removal.isPending.value && removal.variables.value === file.id;

    return () => (
      <ElTable class={styles.root} data={props.files} height="100%" v-loading={showMask.value}>
        {{
          default: () => [
            <ElTableColumn prop="year" label="年份" width="80" align="center" />,
            <ElTableColumn prop="name" label="文档名称" minWidth="260" showOverflowTooltip />,
            <ElTableColumn prop="createdName" label="上传人" width="120" showOverflowTooltip />,
            <ElTableColumn prop="type" label="文档类型" width="100" align="center" />,
            <ElTableColumn label="业务类型标签" width="140">
              {{ default: ({ row }: { row: FileRecord }) => <ElTag>{row.tag}</ElTag> }}
            </ElTableColumn>,
            <ElTableColumn prop="createdTime" label="更新时间" width="180" />,
            <ElTableColumn prop="remark" label="备注" minWidth="120" showOverflowTooltip />,
            <ElTableColumn label="操作" width="90" align="center">
              {{
                default: ({ row }: { row: FileRecord }) => (
                  <ElButton link type="danger" loading={isRemoving(row)} onClick={() => void remove(row)}>
                    删除
                  </ElButton>
                )
              }}
            </ElTableColumn>
          ],
          empty: () => {
            if (showSkeleton.value) {
              return <TableSkeleton />;
            }
            // 骨架屏出现之前表体留空，不显示"暂无数据"
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
        }}
      </ElTable>
    );
  }
});
