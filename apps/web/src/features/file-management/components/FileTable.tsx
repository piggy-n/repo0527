import { ElButton, ElMessage, ElMessageBox, ElTable, ElTableColumn, ElTag, vLoading } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { ApiError } from '@/shared/http/errors';
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
    loading: { type: Boolean, required: true },
    error: { type: Boolean, required: true }
  },
  emits: {
    retry: () => true
  },
  setup(props, { emit }) {
    const removal = useDeleteFileMutation();
    const showLoading = useDelayedFlag(() => props.loading);

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
      <ElTable class={styles.root} data={props.files} height="100%" v-loading={showLoading.value}>
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
          // 加载中不显示"暂无数据"：首次加载还没有数据，加载遮罩又要延迟才出现，会先闪出"暂无数据"
          empty: () => {
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
            return props.loading ? '' : '暂无数据';
          }
        }}
      </ElTable>
    );
  }
});
