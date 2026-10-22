import { MxTitle } from '@yzt/ui';
import { ElButton, ElDialog } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { useResourceDetail } from '../composables/useResourceDetail';
import styles from './ResourceManagement.module.scss';

/** 离开编辑中的详情前的确认（useResourceDetail 的 allowLeave）；渲染在组件里，随页面卸载关闭，标题栏和其他弹窗一致 */
export const DiscardChangesDialog = defineComponent({
  name: 'DiscardChangesDialog',
  props: {
    owner: { type: Object as PropType<ReturnType<typeof useResourceDetail>>, required: true }
  },
  setup(props) {
    return () => (
      <ElDialog
        class={['dialog-panel-header', styles.confirmDialog]}
        modelValue={props.owner.confirming.value}
        title="放弃未保存的修改？"
        appendToBody
        destroyOnClose
        closeOnClickModal={false}
        // 点右上角关闭、按 Esc 都算"继续编辑"
        onUpdate:modelValue={(open: boolean) => {
          if (!open) {
            props.owner.answerDiscard(false);
          }
        }}
      >
        {{
          header: () => <MxTitle level="panel">放弃未保存的修改？</MxTitle>,
          default: () => <p class={styles.confirmMessage}>离开后，本次对数据分类和字段名称的修改将不会保存。</p>,
          footer: () => (
            <>
              <ElButton onClick={() => props.owner.answerDiscard(false)}>继续编辑</ElButton>
              <ElButton type="danger" onClick={() => props.owner.answerDiscard(true)}>
                放弃修改
              </ElButton>
            </>
          )
        }}
      </ElDialog>
    );
  }
});
