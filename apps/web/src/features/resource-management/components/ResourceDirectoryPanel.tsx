import { Delete, EditPen, Plus } from '@element-plus/icons-vue';
import { MxTitle, useSplitLayout } from '@yzt/ui';
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElTree,
  type TreeInstance
} from 'element-plus';
import { computed, defineComponent, onBeforeUnmount, type PropType, ref } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceDirectory } from '../api';
import { DIRECTORY_NAME_MAX_LENGTH, useDirectoryEditor } from '../composables/useDirectoryEditor';
import { resourceDirectoryIcon } from '../directory-icons';
import styles from './ResourceManagement.module.scss';

const DIALOG_TITLES = { add: '新增二级目录', rename: '重命名目录' };

/** 资源目录树和目录维护：只能选二级目录；一级分组可以展开收起、在下面新增二级目录 */
export const ResourceDirectoryPanel = defineComponent({
  name: 'ResourceDirectoryPanel',
  props: {
    nodes: { type: Array as PropType<ResourceDirectory[]>, required: true },
    selected: String,
    loading: Boolean,
    error: Boolean,
    // 编辑详情、保存、导入期间不能改目录
    maintenanceDisabled: Boolean,
    // 切换前的确认（例如详情有未保存的修改），返回 false 时不切换
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
    const dialogTitle = computed(() => {
      const kind = editor.target.value?.kind;
      return kind && kind !== 'remove' ? DIALOG_TITLES[kind] : '';
    });
    const actionsDisabled = () => editor.pending.value || props.maintenanceDisabled;

    // ElMessageBox 不随组件卸载关闭：卸载时只关掉本组件打开的确认框
    let confirmingRemoval = false;
    onBeforeUnmount(() => {
      if (confirmingRemoval) {
        ElMessageBox.close();
      }
    });

    async function confirmRemoval(name: string): Promise<boolean> {
      confirmingRemoval = true;
      try {
        await ElMessageBox.confirm(
          <p class={styles.confirmText}>确定删除「{name}」吗？删除后不能恢复。</p>,
          '删除目录',
          { type: 'warning', confirmButtonText: '删除' }
        );
        return true;
      } catch {
        // 点了取消、关闭，或组件卸载时被关闭
        return false;
      } finally {
        confirmingRemoval = false;
      }
    }

    // 删除没有输入弹窗：先开始一次维护（记下节点快照），确认后提交
    async function remove(id: string) {
      if (confirmingRemoval) {
        return;
      }
      editor.open('remove', id);
      const target = editor.target.value;
      if (target?.kind !== 'remove') {
        return;
      }
      if (!(await confirmRemoval(target.name))) {
        editor.close();
        return;
      }
      // submit 仍会核对节点快照、会话和组件是否已卸载，确认框不负责这些
      if (await editor.submit()) {
        ElMessage.success('目录已删除');
      } else if (editor.error.value) {
        ElMessage.error(editor.error.value);
      }
      editor.close();
    }

    async function submit() {
      if (await editor.submit()) {
        ElMessage.success('目录已保存');
      }
    }

    async function selectNode(node: ResourceDirectory) {
      // 先恢复树上的高亮：点到分组或切换被拒绝时，高亮仍在原来的目录上
      tree.value?.setCurrentKey(props.selected);
      if (isGroup(node.id)) {
        return;
      }
      if (props.beforeSelect && !(await props.beforeSelect(node.id))) {
        return;
      }
      emit('select', node.id);
      tree.value?.setCurrentKey(node.id);
      // 窄屏时目录在抽屉里，选完收起
      if (layout.compact.value) {
        layout.closeAside();
      }
    }

    // 操作按钮在树节点里，点击不能同时选中节点
    function renderAction(icon: typeof Plus, label: string, onClick: () => void, type?: 'primary' | 'danger') {
      return (
        <ElButton
          link
          type={type}
          icon={icon}
          disabled={actionsDisabled()}
          aria-label={label}
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            onClick();
          }}
        />
      );
    }

    function renderNode({ data }: { data: ResourceDirectory }) {
      const actions = isGroup(data.id)
        ? [renderAction(Plus, `在${data.name}新增目录`, () => editor.open('add', data.id), 'primary')]
        : [
          renderAction(EditPen, `重命名${data.name}`, () => editor.open('rename', data.id)),
          renderAction(Delete, `删除${data.name}`, () => void remove(data.id), 'danger')
        ];
      return (
        <span class={[styles.treeRow, data.id === props.selected && styles.selected]}>
          <SvgIcon class={styles.treeIcon} name={resourceDirectoryIcon(data)} size={18} />
          <span class={styles.treeName} title={data.name}>
            {data.name}
          </span>
          <span class={styles.treeActions}>{actions}</span>
        </span>
      );
    }

    // 没有目录时：加载中显示提示（延迟出现），失败时只显示上面的失败提示
    function renderEmpty() {
      let text = '暂无资源目录';
      if (showLoading.value) {
        text = '正在加载目录…';
      } else if (props.loading || props.error) {
        text = '';
      }
      return <div class={styles.state}>{text}</div>;
    }

    function renderDialog() {
      const target = editor.target.value;
      return (
        <ElDialog
          class={[styles.dialog, 'dialog-panel-header']}
          modelValue={target !== null && target.kind !== 'remove'}
          title={dialogTitle.value}
          destroyOnClose
          appendToBody
          closeOnClickModal={false}
          // 保存中不能关闭
          closeOnPressEscape={!editor.pending.value}
          showClose={!editor.pending.value}
          onUpdate:modelValue={(open: boolean) => {
            if (!open) {
              editor.close();
            }
          }}
        >
          {{
            header: () => <MxTitle level="panel">{dialogTitle.value}</MxTitle>,
            default: () => (
              <ElForm labelPosition="top">
                <ElFormItem label="目录名称" required error={editor.error.value}>
                  <ElInput
                    modelValue={editor.name.value}
                    onUpdate:modelValue={editor.setName}
                    placeholder="请输入目录名称"
                    maxlength={DIRECTORY_NAME_MAX_LENGTH}
                    showWordLimit
                    disabled={editor.pending.value}
                    onKeydown={(event: Event | KeyboardEvent) => {
                      if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') {
                        return;
                      }
                      // 回车不提交外层表单；输入法选字时的回车不算提交
                      event.preventDefault();
                      if (!event.isComposing) {
                        void submit();
                      }
                    }}
                  />
                </ElFormItem>
              </ElForm>
            ),
            footer: () => (
              <>
                <ElButton disabled={editor.pending.value} onClick={editor.close}>
                  取消
                </ElButton>
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
      );
    }

    return () => (
      <>
        {props.error && (
          <ElAlert type="error" closable={false} class={styles.notice}>
            目录加载失败{props.nodes.length > 0 ? '，当前显示上次结果' : ''}
            <ElButton link type="primary" onClick={() => emit('retry')}>
              重试目录
            </ElButton>
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
            onNode-click={(node: ResourceDirectory) => void selectNode(node)}
          >
            {{ default: renderNode }}
          </ElTree>
        ) : (
          renderEmpty()
        )}
        {renderDialog()}
      </>
    );
  }
});
