import { ElButton, ElMessage, ElMessageBox, ElTable, ElTableColumn, ElTag, vLoading } from 'element-plus';
import { defineComponent, onBeforeUnmount, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import type { FileRecord } from '../api';
import { useFileRemoval } from '../composables/useFileRemoval';
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
    const removal = useFileRemoval();
    // 骨架屏和遮罩都延迟显示：请求很快完成时什么都不出现，避免一闪而过
    const showSkeleton = useDelayedFlag(() => props.initialLoading);
    const showMask = useDelayedFlag(() => props.refreshing);

    // ElMessageBox 不随组件卸载关闭，页面销毁时要关掉本组件打开的确认框；它只能一次关闭全部，所以只在有打开的确认框时调用
    let openConfirms = 0;
    onBeforeUnmount(() => {
      if (openConfirms > 0) {
        ElMessageBox.close();
      }
    });

    async function confirmRemoval(file: FileRecord): Promise<boolean> {
      openConfirms += 1;
      try {
        await ElMessageBox.confirm(`确定删除"${file.name}"吗？删除后不能恢复。`, '删除文件', {
          type: 'warning',
          confirmButtonText: '删除'
        });
        return true;
      } catch {
        // 点了取消、关闭，或页面销毁时被关闭
        return false;
      } finally {
        openConfirms -= 1;
      }
    }

    async function remove(file: FileRecord) {
      if (await removal.remove(file.id, () => confirmRemoval(file))) {
        ElMessage.success('删除成功');
      }
    }

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
                  <ElButton link type="danger" loading={removal.isRemoving(row.id)} onClick={() => void remove(row)}>
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
