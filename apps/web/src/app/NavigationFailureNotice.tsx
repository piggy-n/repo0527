import { ElButton, ElDialog } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { NavigationRecovery } from './navigation-recovery';

/** 页面还没有挂载时也能显示的导航失败提示，使用现有对话框样式 */
export const NavigationFailureNotice = defineComponent({
  name: 'NavigationFailureNotice',
  props: {
    recovery: { type: Object as PropType<NavigationRecovery>, required: true }
  },
  setup(props) {
    return () => (
      <ElDialog
        modelValue={props.recovery.failure.value !== null}
        title="页面加载失败"
        width="min(420px, 90vw)"
        showClose={false}
        closeOnClickModal={false}
        closeOnPressEscape={false}>
        {{
          default: () => '页面暂时无法打开，请检查网络后重试。如果仍然失败，请刷新页面。',
          footer: () => (
            <>
              <ElButton onClick={props.recovery.reload}>刷新页面</ElButton>
              <ElButton type="primary" loading={props.recovery.retrying.value} onClick={props.recovery.retry}>
                重试
              </ElButton>
            </>
          )
        }}
      </ElDialog>
    );
  }
});
