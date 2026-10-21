import { Delete, EditPen, Plus } from '@element-plus/icons-vue';
import { MxTitle, useSplitLayout } from '@yzt/ui';
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElTree, type TreeInstance } from 'element-plus';
import { computed, defineComponent, onBeforeUnmount, type PropType, ref } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceDirectory } from '../api';
import { useDirectoryEditor } from '../composables/useDirectoryEditor';
import { resourceDirectoryIcon } from '../directory-icons';
import styles from './ResourceManagement.module.scss';

/** 目录树和维护弹窗；二级节点可选择，顶层分组可展开和新增 */
export const ResourceDirectoryPanel = defineComponent({
  name: 'ResourceDirectoryPanel',
  props: {
    nodes: { type: Array as PropType<ResourceDirectory[]>, required: true },
    selected: String,
    loading: Boolean,
    error: Boolean,
    maintenanceDisabled: Boolean,
    beforeSelect: Function as PropType<(id: string) => Promise<boolean>>
  },
  emits: {
    select: (_id: string) => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const layout = useSplitLayout();
    const tree = ref<TreeInstance>();
    const editor = useDirectoryEditor(() => props.nodes);
    const showLoading = useDelayedFlag(() => props.loading);
    const showSaving = useDelayedFlag(editor.pending);
    const isGroup = (id: string) => props.nodes.some(group => group.id === id);
    const labels = { add: '新增二级目录', rename: '重命名目录' };
    const dialogTitle = computed(() => {
      const kind = editor.target.value?.kind;
      return kind && kind !== 'remove' ? labels[kind] : '';
    });
    // MessageBox 独立于组件挂载，仅关闭本组件当前拥有的确认框
    let confirmingRemoval = false;
    onBeforeUnmount(() => {
      if (confirmingRemoval) { ElMessageBox.close(); }
    });

    async function remove(id: string) {
      editor.open('remove', id);
      const target = editor.target.value;
      if (!target || target.kind !== 'remove' || confirmingRemoval) { return; }
      confirmingRemoval = true;
      try {
        await ElMessageBox.confirm(
          <p class={styles.confirmText}>确定删除「{target.name}」吗？删除后不能恢复。</p>,
          '删除目录',
          { type: 'warning', confirmButtonText: '删除' }
        );
      } catch {
        editor.close();
        return;
      } finally {
        confirmingRemoval = false;
      }
      // submit 仍检查节点快照、管理员会话和卸载状态，确认框本身不承担业务校验
      if (await editor.submit()) {
        ElMessage.success('目录已删除');
      } else if (editor.error.value) {
        ElMessage.error(editor.error.value);
      }
      editor.close();
    }

    async function submit() {
      const kind = editor.target.value?.kind;
      if (await editor.submit()) {
        ElMessage.success(kind === 'remove' ? '目录已删除' : '目录已保存');
      }
    }

    return () => (
      <>
        {props.error && (
          <ElAlert type="error" closable={false} class={styles.notice}>
            目录加载失败{props.nodes.length > 0 ? '，当前显示上次结果' : ''}
            <ElButton link type="primary" onClick={() => emit('retry')}>重试目录</ElButton>
          </ElAlert>
        )}
        {props.nodes.length > 0 ? (
          <ElTree
            class={styles.tree}
            ref={tree}
            data={props.nodes}
            props={{ label: 'name', children: 'children' }}
            nodeKey="id"
            defaultExpandAll
            highlightCurrent
            currentNodeKey={props.selected}
            onNode-click={async (node: ResourceDirectory) => {
              tree.value?.setCurrentKey(props.selected);
              if (isGroup(node.id)) {
                return;
              } else {
                if (props.beforeSelect && !await props.beforeSelect(node.id)) { return; }
                emit('select', node.id);
                tree.value?.setCurrentKey(node.id);
                if (layout.compact.value) {
                  layout.closeAside();
                }
              }
            }}
          >
            {{
              default: ({ data }: { data: ResourceDirectory }) => (
                <span class={[styles.treeRow, data.id === props.selected && styles.selected]}>
                  <SvgIcon class={styles.treeIcon} name={resourceDirectoryIcon(data)} size={18} />
                  <span class={styles.treeName} title={data.name}>{data.name}</span>
                  <span class={styles.treeActions}>
                    {isGroup(data.id) ? (
                      <ElButton
                        link
                        type="primary"
                        icon={Plus}
                        disabled={editor.pending.value || props.maintenanceDisabled}
                        aria-label={`在${data.name}新增目录`}
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation();
                          editor.open('add', data.id);
                        }}
                      />
                    ) : (
                      <>
                        <ElButton
                          link
                          icon={EditPen}
                          disabled={editor.pending.value || props.maintenanceDisabled}
                          aria-label={`重命名${data.name}`}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation();
                            editor.open('rename', data.id);
                          }}
                        />
                        <ElButton
                          link
                          type="danger"
                          icon={Delete}
                          disabled={editor.pending.value || props.maintenanceDisabled}
                          aria-label={`删除${data.name}`}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation();
                            void remove(data.id);
                          }}
                        />
                      </>
                    )}
                  </span>
                </span>
              )
            }}
          </ElTree>
        ) : <div class={styles.state}>{showLoading.value ? '正在加载目录…' : props.loading || props.error ? '' : '暂无资源目录'}</div>}
        <ElDialog
          class={[styles.dialog, 'dialog-panel-header']}
          modelValue={editor.target.value !== null && editor.target.value.kind !== 'remove'}
          title={dialogTitle.value}
          destroyOnClose
          appendToBody
          closeOnClickModal={false}
          closeOnPressEscape={!editor.pending.value}
          showClose={!editor.pending.value}
          onUpdate:modelValue={(open: boolean) => { if (!open) { editor.close(); } }}
        >
          {{
            header: () => (
              <MxTitle level="panel">{dialogTitle.value}</MxTitle>
            ),
            default: () => (
              <ElForm labelPosition="top">
                <ElFormItem label="目录名称" required error={editor.error.value}>
                  <ElInput
                    modelValue={editor.name.value}
                    onUpdate:modelValue={editor.setName}
                    placeholder="请输入目录名称"
                    maxlength={20}
                    showWordLimit
                    disabled={editor.pending.value}
                    onKeydown={(event: Event | KeyboardEvent) => {
                      if (event instanceof KeyboardEvent && event.key === 'Enter') {
                        event.preventDefault();
                        if (!event.isComposing) { void submit(); }
                      }
                    }}
                  />
                </ElFormItem>
              </ElForm>
            ),
            footer: () => (
              <>
                <ElButton disabled={editor.pending.value} onClick={editor.close}>取消</ElButton>
                <ElButton
                  type="primary"
                  disabled={editor.pending.value}
                  loading={showSaving.value}
                  onClick={() => void submit()}
                >
                  保存目录
                </ElButton>
              </>
            )
          }}
        </ElDialog>
      </>
    );
  }
});
