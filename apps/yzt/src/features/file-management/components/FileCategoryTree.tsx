import { useSplitLayout } from '@yzt/ui';
import { ElTree, type TreeInstance } from 'element-plus';
import { defineComponent, ref } from 'vue';
import { fileCategories, findCategoryPath } from '../categories';

/** 文件分类树：只有叶子能选中；窄屏时选中后关闭抽屉，必须放在 MxSplitLayout 的侧栏里 */
export const FileCategoryTree = defineComponent({
  name: 'FileCategoryTree',
  props: {
    modelValue: { type: String, required: true }
  },
  emits: {
    'update:modelValue': (_id: string) => true
  },
  setup(props, { emit }) {
    const { compact, closeAside } = useSplitLayout();
    const treeRef = ref<TreeInstance>();
    // 只在创建时展开当前分类的上级，之后的展开收起由用户决定
    const expandedKeys = findCategoryPath(props.modelValue)
      .slice(0, -1)
      .map(node => node.id);

    // ElTree 传入的节点数据类型是 Record<string, any>，这里只声明用到的字段再收窄
    const select = (node: { id?: unknown; children?: unknown }) => {
      if (node.children) {
        // 点分组只展开收起；Element 会把当前节点切到分组上，恢复为选中的分类
        treeRef.value?.setCurrentKey(props.modelValue);
        return;
      }
      if (typeof node.id === 'string' && node.id !== props.modelValue) {
        emit('update:modelValue', node.id);
      }
      if (compact.value) {
        closeAside();
      }
    };

    return () => (
      <ElTree
        ref={treeRef}
        data={fileCategories}
        nodeKey="id"
        highlightCurrent
        currentNodeKey={props.modelValue}
        defaultExpandedKeys={expandedKeys}
        onNode-click={select}
      />
    );
  }
});
